'use strict';

// you have to require the utils module and call adapter function
const utils = require('@iobroker/adapter-core'); // Get common adapter utils
const adapterName = require('./package.json').name.split('.').pop();

// include node-ssdp and node-upnp-subscription
const {Client, Server} = require('node-ssdp');
const Subscription = require('./lib/upnp-subscription');
const parseString = require('xml2js').parseString;
const DOMParser = require('xmldom').DOMParser;
const request = require('request');
const nodeSchedule = require('node-schedule');

let adapter;
let client = new Client();

const tasks = [];
let taskRunning = false;
const actions = {}; // scheduled actions
const crons = {};
const checked = {}; // store checked objects for polling
let discoveredDevices = [];
let sidPromise; // Read SIDs promise
let globalCb;  // callback for last processTasks

function startCronJob(cron) {
    console.log('Start cron JOB: ' + cron);
    crons[cron] = nodeSchedule.scheduleJob(cron, () => pollActions(cron));
}

function stopCronJob(cron) {
    if (crons[cron]) {
        crons[cron].cancel();
        delete crons[cron];
    }
}

function pollActions(cron) {
    Object.keys(actions).forEach(id =>
        actions[id].cron === cron && addTask({name: 'sendCommand', id}));

    processTasks();
}

function reschedule(changedId, deletedCron) {
    const schedules = {};
    if (changedId) {
        if (!deletedCron) {
            Object.keys(actions).forEach(_id => {
                if (_id !== changedId) {
                    const cron = actions[_id].cron;
                    schedules[cron] = schedules[cron] || 0;
                    schedules[cron]++;
                }
            });

            if (!schedules[actions[changedId].cron]) {
                // start cron job
                startCronJob(actions[changedId].cron);
            }
        } else {
            Object.keys(actions).forEach(_id => {
                const cron = actions[_id].cron;
                schedules[cron] = schedules[cron] || 0;
                schedules[cron]++;
            });
            if (schedules[deletedCron] === 1 && crons[deletedCron]) {
                // stop cron job
                stopCronJob(deletedCron);
            }
        }
    } else {
        // first
        Object.keys(actions).forEach(_id => {
            const cron = actions[_id].cron;
            schedules[cron] = schedules[cron] || 0;
            schedules[cron]++;
        });
        Object.keys(schedules).forEach(cron => startCronJob(cron));
    }
}

function startAdapter(options) {
    options = options || {};
    Object.assign(options, {name: adapterName, strictObjectChecks: false});

    adapter = new utils.Adapter(options);
    // is called when adapter shuts down - callback has to be called under any circumstances!
    adapter.on('unload', callback => {
        try {
            server.stop(); // advertise shutting down and stop listening
            adapter.log.info('cleaned everything up...');
            clearAliveAndSIDStates(callback);
        } catch (e) {
            callback();
        }
    });

    adapter.on('objectChange', (id, obj) => {
        if (obj && obj.common && obj.common.custom &&
            obj.common.custom[adapter.namespace] &&
            obj.common.custom[adapter.namespace].enabled &&
            obj.native && obj.native.request
        ) {
            if (!actions[id]) {
                adapter.log.info(`enabled polling of ${id} with schedule ${obj.common.custom[adapter.namespace].schedule}`);
                setImmediate(() => reschedule(id));
            }
            actions[id] = {cron: obj.common.custom[adapter.namespace].schedule};
        } else if (actions[id]) {
            adapter.log.debug('Removed polling for ' + id);
            setImmediate((id, cron) => reschedule(id, cron), id, actions[id].cron);
            delete actions[id];
        }
    });

    // is called if a subscribed state changes
    adapter.on('stateChange', (id, state) => {
        if (!state || state.ack) {
            return;
        }

        // Subscribe to an service when its state Alive is true

        if (id.match(/\.request$/)) {
            // Control a device when a related object changes its value
            if (checked[id] !== undefined) {
                checked[id] && sendCommand(id);
            } else {
                adapter.getObject(id, (err, obj) => {
                    if (obj && obj.native && obj.native.request) {
                        checked[id] = true;
                        sendCommand(id);
                    } else {
                        checked[id] = false;
                    }
                });
            }
        }
    });

    // is called when databases are connected and adapter received configuration.
    // start here!
    adapter.on('ready', () => {
        main();
    });

    // Some message was sent to adapter instance over message box. Used by email, pushover, text2speech, ...
    adapter.on('message', obj => {
        if (typeof obj === 'object' && obj.message) {
            if (obj.command === 'send') {
                // e.g. send email or pushover or whatever
                adapter.log.info('send command');

                // Send response in callback if required
                obj.callback && adapter.sendTo(obj.from, obj.command, 'Message received', obj.callback);
            }
        }
    });
    return adapter;
}

function getValueFromArray(value) {
    if (typeof value === 'object' && value instanceof Array && value[0] !== undefined) {
        return value[0] !== null ? value[0].toString() : '';
    } else {
        return value !== null && value !== undefined ? value.toString() : '';
    }
}

let foundIPs = []; // Array for the caught broadcast answers

function sendBroadcast() {
    // adapter.log.debug('Send Broadcast');

    // Sends a Broadcast and catch the URL with xml device description file
    client.on('response', (headers, _statusCode, _rinfo) => {
        let answer = (headers || {}).LOCATION;

        if (answer && foundIPs.indexOf(answer) === -1) {
            foundIPs.push(answer);

            if (answer !== answer.match(/.*dummy.xml/g)) {
                setTimeout(() => firstDevLookup(answer), 1000);
            }
        }
    });

    client.search('ssdp:all');
}

// Read the xml device description file of each upnp device the first time
function firstDevLookup(strLocation, cb) {
    const originalStrLocation = strLocation;
    adapter.log.debug('firstDevLookup for ' + strLocation);

    request(strLocation, (error, response, body) => {
        if (!error && response.statusCode === 200) {
            adapter.log.debug('Positive answer for request of the XML file for ' + strLocation);

            try {
                const xmlStringSerialized = new DOMParser().parseFromString((body || '').toString(), 'text/xml');

                parseString(xmlStringSerialized, {explicitArray: true, mergeAttrs: true}, (err, result) => {
                    let path;
                    let xmlDeviceType;
                    let xmlTypeOfDevice;
                    let xmlUDN;
                    let xmlManufacturer;

                    adapter.log.debug('Parsing the XML file for ' + strLocation);

                    if (err) {
                        adapter.log.warn('Error: ' + err);
                    } else {
                        adapter.log.debug('Creating objects for ' + strLocation);
                        let i;

                        if (!result || !result.root || !result.root.device) {
                            adapter.log.debug('Error by parsing of ' + strLocation + ': Cannot find deviceType');
                            return;
                        }

                        path = result.root.device[0];
                        //Looking for deviceType of device
                        try {
                            xmlDeviceType = getValueFromArray(path.deviceType);
                            xmlTypeOfDevice = xmlDeviceType.replace(/:\d/, '');
                            xmlTypeOfDevice = xmlTypeOfDevice.replace(/.*:/, '');
                            xmlTypeOfDevice = nameFilter(xmlTypeOfDevice);
                            adapter.log.debug('TypeOfDevice ' + xmlTypeOfDevice);
                        } catch (err) {
                            adapter.log.debug(`Can not read deviceType of ${strLocation}`);
                            xmlDeviceType = '';
                        }

                        //Looking for the port
                        let strPort = strLocation.replace(/\bhttp:\/\/.*\d:/ig, '');
                        strPort = strPort.replace(/\/.*/g, '');
                        if (strPort.match(/http:/ig)) {
                            strPort = '';
                        } else {
                            strPort = parseInt(strPort, 10);
                        }

                        // Looking for the IP of a device
                        strLocation = strLocation.replace(/http:\/\/|"/g, '').replace(/:\d*\/.*/ig, '');

                        //Looking for UDN of a device
                        try {
                            xmlUDN = getValueFromArray(path.UDN).replace(/"/g, '').replace(/uuid:/g, '');
                        } catch (err) {
                            adapter.log.debug(`Can not read UDN of ${strLocation}`);
                            xmlUDN = '';
                        }

                        //Looking for the manufacturer of a device
                        try {
                            xmlManufacturer = getValueFromArray(path.manufacturer).replace(/"/g, '');
                        } catch (err) {
                            adapter.log.debug('Can not read manufacturer of ' + strLocation);
                            xmlManufacturer = '';
                        }

                        // Extract the path to the device icon that is delivered by the device
                        // let i_icons = 0;
                        let xmlIconURL;
                        let xmlFN;
                        let xmlManufacturerURL;
                        let xmlModelNumber;
                        let xmlModelDescription;
                        let xmlModelName;
                        let xmlModelURL;

                        try {
                            // i_icons = path.iconList[0].icon.length;
                            xmlIconURL = getValueFromArray(path.iconList[0].icon[0].url).replace(/"/g, '');
                        } catch (err) {
                            adapter.log.debug(`Can not find a icon for ${strLocation}`);
                            xmlIconURL = '';
                        }

                        //Looking for the friendlyName of a device
                        try {
                            xmlFN = nameFilter(getValueFromArray(path.friendlyName));
                        } catch (err) {
                            adapter.log.debug(`Can not read friendlyName of ${strLocation}`);
                            xmlFN = 'Unknown';
                        }

                        //Looking for the manufacturerURL
                        try {
                            xmlManufacturerURL = getValueFromArray(path.manufacturerURL).replace(/"/g, '');
                        } catch (err) {
                            adapter.log.debug(`Can not read manufacturerURL of ${strLocation}`);
                            xmlManufacturerURL = '';
                        }

                        // Looking for the modelNumber
                        try {
                            xmlModelNumber = getValueFromArray(path.modelNumber).replace(/"/g, '');
                        } catch (err) {
                            adapter.log.debug(`Can not read modelNumber of ${strLocation}`);
                            xmlModelNumber = '';
                        }

                        // Looking for the modelDescription
                        try {
                            xmlModelDescription = getValueFromArray(path.modelDescription).replace(/"/g, '');
                        } catch (err) {
                            adapter.log.debug(`Can not read modelDescription of ${strLocation}`);
                            xmlModelDescription = '';
                        }

                        // Looking for the modelName
                        try {
                            xmlModelName = getValueFromArray(path.modelName).replace(/"/g, '');
                        } catch (err) {
                            adapter.log.debug(`Can not read modelName of ${strLocation}`);
                            xmlModelName = '';
                        }

                        // Looking for the modelURL
                        try {
                            xmlModelURL = getValueFromArray(path.modelURL).replace(/"/g, '');
                        } catch (err) {
                            adapter.log.debug(`Can not read modelURL of ${strLocation}`);
                            xmlModelURL = '';
                        }


                        // START - Creating the root object of a device
                        adapter.log.debug(`Creating root element for device: ${xmlFN}`);

                        addTask({
                            name: 'setObjectNotExists',
                            id: `${xmlFN}.${xmlTypeOfDevice}`,
                            obj: {
                                type: 'device',
                                common: {
                                    name: xmlFN,
                                    extIcon: `http://${strLocation}:${strPort}${xmlIconURL}`
                                },
                                native: {
                                    ip: strLocation,
                                    port: strPort,
                                    uuid: xmlUDN,
                                    deviceType: xmlDeviceType,
                                    manufacturer: xmlManufacturer,
                                    manufacturerURL: xmlManufacturerURL,
                                    modelNumber: xmlModelNumber,
                                    modelDescription: xmlModelDescription,
                                    modelName: xmlModelName,
                                    modelURL: xmlModelURL,
                                    name: xmlFN,
                                }
                            }
                        });
                        let pathRoot = result.root.device[0];
                        let objectName = `${xmlFN}.${xmlTypeOfDevice}`;
                        createServiceList(result, xmlFN, xmlTypeOfDevice, objectName, strLocation, strPort, pathRoot);
                        const aliveID = `${adapter.namespace}.${xmlFN}.${xmlTypeOfDevice}.Alive`;
                        addTask({
                            name: 'setObjectNotExists',
                            id: aliveID,
                            obj: {
                                type: 'state',
                                common: {
                                    name: 'Alive',
                                    type: 'boolean',
                                    role: 'indicator.reachable',
                                    def: false,
                                    read: true,
                                    write: false
                                },
                                native: {}
                            }
                        });

                        // Add to Alives list
                        getIDs()
                            .then(result => result.alives.indexOf(aliveID) === -1 && result.alives.push(aliveID));

                        // START - Creating SubDevices list for a device
                        let lenSubDevices = 0;
                        let xmlfriendlyName;

                        if (path.deviceList && path.deviceList[0].device) {
                            // Counting SubDevices
                            lenSubDevices = path.deviceList[0].device.length;

                            if (lenSubDevices) {
                                // adapter.log.debug('Found more than one SubDevice');
                                for (i = lenSubDevices - 1; i >= 0; i--) {

                                    // Looking for deviceType of device
                                    try {
                                        xmlDeviceType = getValueFromArray(path.deviceList[0].device[i].deviceType).replace(/"/g, '');
                                        xmlTypeOfDevice = xmlDeviceType.replace(/:\d/, '');
                                        xmlTypeOfDevice = xmlTypeOfDevice.replace(/.*:/, '');
                                        xmlTypeOfDevice = nameFilter(xmlTypeOfDevice);
                                        adapter.log.debug(`TypeOfDevice ${xmlTypeOfDevice}`);
                                    } catch (err) {
                                        adapter.log.debug(`Can not read deviceType of ${strLocation}`);
                                        xmlDeviceType = '';
                                    }

                                    //Looking for the friendlyName of the SubDevice
                                    try {
                                        xmlfriendlyName = getValueFromArray(path.deviceList[0].device[i].friendlyName);
                                        xmlFN = nameFilter(xmlfriendlyName);
                                    } catch (err) {
                                        adapter.log.debug(`Can not read friendlyName of SubDevice from ${xmlFN}`);
                                        xmlfriendlyName = 'Unknown';
                                    }
                                    //Looking for the manufacturer of a device
                                    try {
                                        xmlManufacturer = getValueFromArray(path.deviceList[0].device[i].manufacturer).replace(/"/g, '');
                                    } catch (err) {
                                        adapter.log.debug(`Can not read manufacturer of ${xmlfriendlyName}`);
                                        xmlManufacturer = '';
                                    }
                                    //Looking for the manufacturerURL
                                    try {
                                        xmlManufacturerURL = getValueFromArray(path.deviceList[0].device[i].manufacturerURL);
                                    } catch (err) {
                                        adapter.log.debug(`Can not read manufacturerURL of ${xmlfriendlyName}`);
                                        xmlManufacturerURL = '';
                                    }
                                    //Looking for the modelNumber
                                    try {
                                        xmlModelNumber = getValueFromArray(path.deviceList[0].device[i].modelNumber);
                                    } catch (err) {
                                        adapter.log.debug(`Can not read modelNumber of ${xmlfriendlyName}`);
                                        xmlModelNumber = '';
                                    }
                                    //Looking for the modelDescription
                                    try {
                                        xmlModelDescription = getValueFromArray(path.deviceList[0].device[i].modelDescription);
                                    } catch (err) {
                                        adapter.log.debug(`Can not read modelDescription of ${xmlfriendlyName}`);
                                        xmlModelDescription = '';
                                    }
                                    //Looking for deviceType of device
                                    try {
                                        xmlDeviceType = getValueFromArray(path.deviceList[0].device[i].deviceType);
                                    } catch (err) {
                                        adapter.log.debug(`Can not read DeviceType of ${xmlfriendlyName}`);
                                        xmlDeviceType = '';
                                    }
                                    //Looking for the modelName
                                    try {
                                        xmlModelName = getValueFromArray(path.deviceList[0].device[i].modelName);
                                    } catch (err) {
                                        adapter.log.debug(`Can not read modelName of ${xmlfriendlyName}`);
                                        xmlModelName = '';
                                    }
                                    //Looking for the modelURL
                                    try {
                                        xmlModelURL = path.deviceList[0].device[i].modelURL;
                                    } catch (err) {
                                        adapter.log.debug(`Can not read modelURL of ${xmlfriendlyName}`);
                                        xmlModelURL = '';
                                    }
                                    //Looking for UDN of a device
                                    try {
                                        xmlUDN = getValueFromArray(path.deviceList[0].device[i].UDN)
                                            .replace(/"/g, '')
                                            .replace(/uuid:/g, '');
                                    } catch (err) {
                                        adapter.log.debug(`Can not read UDN of ${xmlfriendlyName}`);
                                        xmlUDN = '';
                                    }

                                    //The SubDevice object
                                    addTask({
                                        name: 'setObjectNotExists',
                                        id: `${xmlFN}.${xmlTypeOfDevice}`,
                                        obj: {
                                            type: 'device',
                                            common: {
                                                name: xmlfriendlyName
                                            },
                                            native: {
                                                ip: strLocation,
                                                port: strPort,
                                                uuid: xmlUDN,
                                                deviceType: xmlDeviceType.toString(),
                                                manufacturer: xmlManufacturer.toString(),
                                                manufacturerURL: xmlManufacturerURL.toString(),
                                                modelNumber: xmlModelNumber.toString(),
                                                modelDescription: xmlModelDescription.toString(),
                                                modelName: xmlModelName.toString(),
                                                modelURL: xmlModelURL.toString(),
                                                name: xmlfriendlyName
                                            }
                                        }
                                    }); //END SubDevice Object
                                    let pathSub = result.root.device[0].deviceList[0].device[i];
                                    let objectNameSub = `${xmlFN}.${xmlTypeOfDevice}`;
                                    createServiceList(result, xmlFN, xmlTypeOfDevice, objectNameSub, strLocation, strPort, pathSub);
                                    const aliveID = `${adapter.namespace}.${xmlFN}.${xmlTypeOfDevice}.Alive`;
                                    addTask({
                                        name: 'setObjectNotExists',
                                        id: aliveID,
                                        obj: {
                                            type: 'state',
                                            common: {
                                                name: 'Alive',
                                                type: 'boolean',
                                                role: 'indicator.reachable',
                                                def: false,
                                                read: true,
                                                write: false
                                            },
                                            native: {}
                                        }
                                    });

                                    // Add to Alives list
                                    getIDs()
                                        .then(result => result.alives.indexOf(aliveID) === -1 && result.alives.push(aliveID));

                                    let TypeOfSubDevice = xmlTypeOfDevice;

                                    //START - Creating SubDevices list for a sub-device
                                    if (path.deviceList[0].device[i].deviceList && path.deviceList[0].device[i].deviceList[0].device) {
                                        //Counting SubDevices
                                        let i_SubSubDevices = path.deviceList[0].device[i].deviceList[0].device.length;
                                        let i2;

                                        if (i_SubSubDevices) {
                                            for (i2 = i_SubSubDevices - 1; i2 >= 0; i--) {

                                                adapter.log.debug(`Device ${i2} ` + path.deviceList[0].device[i].deviceList[0].device[i2].friendlyName);

                                                //Looking for deviceType of device
                                                try {
                                                    xmlDeviceType = getValueFromArray(path.deviceList[0].device[i].deviceList[0].device[i2].deviceType).replace(/"/g, '');
                                                    xmlTypeOfDevice = xmlDeviceType
                                                        .replace(/:\d/, '')
                                                        .replace(/.*:/, '');
                                                    xmlTypeOfDevice = nameFilter(xmlTypeOfDevice);
                                                    adapter.log.debug(`TypeOfDevice ${xmlTypeOfDevice}`);
                                                } catch (err) {
                                                    adapter.log.debug(`Can not read deviceType of ${strLocation}`);
                                                    xmlDeviceType = '';
                                                }

                                                //Looking for the friendlyName of the SubDevice
                                                try {
                                                    xmlfriendlyName = getValueFromArray(path.deviceList[0].device[i].deviceList[0].device[i2].friendlyName);
                                                    xmlFN = nameFilter(xmlfriendlyName);
                                                } catch (err) {
                                                    adapter.log.debug(`Can not read friendlyName of SubDevice from ${xmlFN}`);
                                                    xmlfriendlyName = 'Unknown';
                                                }
                                                //Looking for the manufacturer of a device
                                                try {
                                                    xmlManufacturer = getValueFromArray(path.deviceList[0].device[i].deviceList[0].device[i2].manufacturer).replace(/"/g, '');
                                                } catch (err) {
                                                    adapter.log.debug(`Can not read manufacturer of ${xmlfriendlyName}`);
                                                    xmlManufacturer = '';
                                                }
                                                //Looking for the manufacturerURL
                                                try {
                                                    xmlManufacturerURL = getValueFromArray(path.deviceList[0].device[i].deviceList[0].device[i2].manufacturerURL);
                                                } catch (err) {
                                                    adapter.log.debug(`Can not read manufacturerURL of ${xmlfriendlyName}`);
                                                    xmlManufacturerURL = '';
                                                }
                                                //Looking for the modelNumber
                                                try {
                                                    xmlModelNumber = getValueFromArray(path.deviceList[0].device[i].deviceList[0].device[i2].modelNumber);
                                                } catch (err) {
                                                    adapter.log.debug(`Can not read modelNumber of ${xmlfriendlyName}`);
                                                    xmlModelNumber = '';
                                                }
                                                //Looking for the modelDescription
                                                try {
                                                    xmlModelDescription = getValueFromArray(path.deviceList[0].device[i].deviceList[0].device[i2].modelDescription);
                                                } catch (err) {
                                                    adapter.log.debug(`Can not read modelDescription of ${xmlfriendlyName}`);
                                                    xmlModelDescription = '';
                                                }
                                                //Looking for deviceType of device
                                                try {
                                                    xmlDeviceType = getValueFromArray(path.deviceList[0].device[i].deviceList[0].device[i2].deviceType);
                                                } catch (err) {
                                                    adapter.log.debug('Can not read DeviceType of ' + xmlfriendlyName);
                                                    xmlDeviceType = '';
                                                }
                                                //Looking for the modelName
                                                try {
                                                    xmlModelName = getValueFromArray(path.deviceList[0].device[i].deviceList[0].device[i2].modelName);
                                                } catch (err) {
                                                    adapter.log.debug(`Can not read DeviceType of ${xmlfriendlyName}`);
                                                    xmlModelName = '';
                                                }
                                                //Looking for the modelURL
                                                try {
                                                    xmlModelURL = getValueFromArray(path.deviceList[0].device[i].deviceList[0].device[i2].modelURL);
                                                } catch (err) {
                                                    adapter.log.debug(`Can not read modelURL of ${xmlfriendlyName}`);
                                                    xmlModelURL = '';
                                                }
                                                //Looking for UDN of a device
                                                try {
                                                    xmlUDN = getValueFromArray(path.deviceList[0].device[i].deviceList[0].device[i2].UDN)
                                                        .replace(/"/g, '')
                                                        .replace(/uuid:/g, '');
                                                } catch (err) {
                                                    adapter.log.debug(`Can not read UDN of ${xmlfriendlyName}`);
                                                    xmlUDN = '';
                                                }

                                                //The SubDevice object
                                                addTask({
                                                    name: 'setObjectNotExists',
                                                    id: `${xmlFN}.${TypeOfSubDevice}.${xmlTypeOfDevice}`,
                                                    obj: {
                                                        type: 'device',
                                                        common: {
                                                            name: xmlfriendlyName
                                                        },
                                                        native: {
                                                            ip: strLocation,
                                                            port: strPort,
                                                            uuid: xmlUDN,
                                                            deviceType: xmlDeviceType.toString(),
                                                            manufacturer: xmlManufacturer.toString(),
                                                            manufacturerURL: xmlManufacturerURL.toString(),
                                                            modelNumber: xmlModelNumber.toString(),
                                                            modelDescription: xmlModelDescription.toString(),
                                                            modelName: xmlModelName.toString(),
                                                            modelURL: xmlModelURL.toString(),
                                                            name: xmlfriendlyName
                                                        }
                                                    }
                                                }); //END SubDevice Object
                                                pathSub = result.root.device[0].deviceList[0].device[i].deviceList[0].device[i2];
                                                objectNameSub = `${xmlFN}.${TypeOfSubDevice}.${xmlTypeOfDevice}`;
                                                createServiceList(result, xmlFN, `${TypeOfSubDevice}.${xmlTypeOfDevice}`, objectNameSub, strLocation, strPort, pathSub);
                                                const aliveID = `${adapter.namespace}.${xmlFN}.${TypeOfSubDevice}.${xmlTypeOfDevice}.Alive`;
                                                addTask({
                                                    name: 'setObjectNotExists',
                                                    id: aliveID,
                                                    obj: {
                                                        type: 'state',
                                                        common: {
                                                            name: 'Alive',
                                                            type: 'boolean',
                                                            role: 'indicator.reachable',
                                                            def: false,
                                                            read: true,
                                                            write: false
                                                        },
                                                        native: {}
                                                    }
                                                });
                                                // Add to Alives list
                                                getIDs()
                                                    .then(result => result.alives.indexOf(aliveID) === -1 && result.alives.push(aliveID));
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }

                    // remove device from processed list
                    const pos = discoveredDevices.indexOf(originalStrLocation);
                    pos !== -1 && discoveredDevices.splice(pos, 1);
                    processTasks();
                    cb && cb();
                });
            } catch (error) {
                adapter.log.debug(`Cannot parse answer from ${strLocation}: ${error}`);
                // remove device from processed list
                const pos = discoveredDevices.indexOf(originalStrLocation);
                pos !== -1 && discoveredDevices.splice(pos, 1);
                processTasks();
                cb && cb();
            }
        } else {
            // remove device from processed list
            const pos = discoveredDevices.indexOf(originalStrLocation);
            pos !== -1 && discoveredDevices.splice(pos, 1);
            cb && cb();
        }

    });
}

function createServiceList(result, xmlFN, xmlTypeOfDevice, object, strLocation, strPort, path) {
    if (!path.serviceList) {
        adapter.log.debug('No service list found at ' + JSON.stringify(path));
        return;
    }

    if (!path.serviceList[0] || !path.serviceList[0].service || !path.serviceList[0].service.length) {
        adapter.log.debug('No services found in the service list');
        return;
    }

    let i;
    let xmlService;
    let xmlServiceType;
    let xmlServiceID;
    let xmlControlURL;
    let xmlEventSubURL;
    let xmlSCPDURL;
    let i_services = path.serviceList[0].service.length;


    //Counting services
    //adapter.log.debug('Number of services: ' + i_services);

    for (i = i_services - 1; i >= 0; i--) {

        try {
            xmlService = getValueFromArray(path.serviceList[0].service[i].serviceType)
                .replace(/urn:.*:service:/g, '')
                .replace(/:\d/g, '')
                .replace(/"/g, '');
        } catch (err) {
            adapter.log.debug(`Can not read service of ${xmlFN}`);
            xmlService = 'Unknown';
        }

        try {
            xmlServiceType = getValueFromArray(path.serviceList[0].service[i].serviceType);
        } catch (err) {
            adapter.log.debug(`Can not read serviceType of ${xmlService}`);
            xmlServiceType = '';
        }

        try {
            xmlServiceID = getValueFromArray(path.serviceList[0].service[i].serviceId);
        } catch (err) {
            adapter.log.debug(`Can not read serviceID of ${xmlService}`);
            xmlServiceID = '';
        }

        try {
            xmlControlURL = getValueFromArray(path.serviceList[0].service[i].controlURL);
        } catch (err) {
            adapter.log.debug(`Can not read controlURL of ${xmlService}`);
            xmlControlURL = '';
        }

        try {
            xmlEventSubURL = getValueFromArray(path.serviceList[0].service[i].eventSubURL);
        } catch (err) {
            adapter.log.debug(`Can not read eventSubURL of ${xmlService}`);
            xmlEventSubURL = '';
        }

        try {
            xmlSCPDURL = getValueFromArray(path.serviceList[0].service[i].SCPDURL);
            if (!xmlSCPDURL.match(/^\//)) {
                xmlSCPDURL = `/${xmlSCPDURL}`;
            }
        } catch (err) {
            adapter.log.debug(`Can not read SCPDURL of ${xmlService}`);
            xmlSCPDURL = '';
        }

        addTask({
            name: 'setObjectNotExists',
            id: `${object}.${xmlService}`,
            obj: {
                type: 'channel',
                common: {
                    name: xmlService
                },
                native: {
                    serviceType: xmlServiceType,
                    serviceID: xmlServiceID,
                    controlURL: xmlControlURL,
                    eventSubURL: xmlEventSubURL,
                    SCPDURL: xmlSCPDURL,
                    name: xmlService
                }
            }
        });

        const sid = `${adapter.namespace}.${object}.${xmlService}.sid`;
        addTask({
            name: 'setObjectNotExists',
            id: sid,
            obj: {
                type: 'state',
                common: {
                    name: 'Subscription ID',
                    type: 'string',
                    role: 'state',
                    def: '',
                    read: true,
                    write: true
                },
                native: {}
            }
        });

        // Add to SID list
        getIDs()
            .then(result => result.sids.indexOf(sid) === -1 && result.sids.push(sid));

        let SCPDlocation = `http://${strLocation}:${strPort}${xmlSCPDURL}`;
        let service = `${xmlFN}.${xmlTypeOfDevice}.${xmlService}`;
        addTask({name: 'readSCPD', SCPDlocation, service});
    }
}

// Read the SCPD File  of a upnp device service
function readSCPD(SCPDlocation, service, cb) {

    adapter.log.debug('readSCPD for ' + SCPDlocation);

    request(SCPDlocation, (error, response, body) => {
        if (!error && response.statusCode === 200) {

            try {
                parseString(body, {explicitArray: true}, (err, result) => {
                    adapter.log.debug('Parsing the SCPD XML file for ' + SCPDlocation);
                    if (err) {
                        adapter.log.warn('Error: ' + err);
                        cb();
                    } else if (!result || !result.scpd) {
                        adapter.log.debug('Error by parsing of ' + SCPDlocation);
                        cb();
                    } else {
                        createServiceStateTable(result, service);
                        createActionList(result, service);
                        processTasks();
                        cb();
                    }
                }); //END function
            } catch (error) {
                adapter.log.debug(`Cannot parse answer from ${SCPDlocation}: ${error}`);
                cb();
            }
        } else {
            cb();
        }
    });
}

function createServiceStateTable(result, service) {
    if (!result.scpd || !result.scpd.serviceStateTable) {
        return;
    }

    let path = result.scpd.serviceStateTable[0] || result.scpd.serviceStateTable;

    if (!path.stateVariable || !path.stateVariable.length) {
        return;
    }

    let iStateVarLength = path.stateVariable.length;
    let xmlName;
    let xmlDataType;

    // Counting stateVariable's
    // adapter.log.debug('Number of stateVariables: ' + iStateVarLength);
    try {
        for (let i2 = iStateVarLength - 1; i2 >= 0; i2--) {
            let stateVariableAttr;
            let strAllowedValues = [];
            let strMinimum;
            let strMaximum;
            let strDefaultValue;
            let strStep;

            stateVariableAttr = path.stateVariable[i2]['$'].sendEvents;
            xmlName = getValueFromArray(path.stateVariable[i2].name);
            xmlDataType = getValueFromArray(path.stateVariable[i2].dataType);

            try {
                let allowed = path.stateVariable[i2].allowedValueList[0].allowedValue;
                strAllowedValues = Object.keys(allowed).map(xmlAllowedValue => allowed[xmlAllowedValue]).join(' ');
            } catch (err) {
            }

            try {
                strDefaultValue = getValueFromArray(path.stateVariable[i2].defaultValue);
            } catch (err) {
            }

            if (path.stateVariable[i2].allowedValueRange) {
                try {
                    strMinimum = getValueFromArray(path.stateVariable[i2].allowedValueRange[0].minimum);
                } catch (err) {
                }

                try {
                    strMaximum = getValueFromArray(path.stateVariable[i2].allowedValueRange[0].maximum);
                } catch (err) {
                }
                try {
                    strStep = getValueFromArray(path.stateVariable[i2].allowedValueRange[0].step);
                } catch (err) {
                }
            }

            // Handles DataType ui2 as Number
            let dataType;
            if (xmlDataType.toString() === 'ui2') {
                dataType = 'number';
            } else {
                dataType = xmlDataType.toString();
            }

            addTask({
                name: 'setObjectNotExists',
                id: `${service}.${xmlName}`,
                obj: {
                    type: 'state',
                    common: {
                        name: xmlName,
                        type: dataType,
                        role: 'state',
                        read: true,
                        write: true
                    },
                    native: {
                        name: xmlName,
                        sendEvents: stateVariableAttr,
                        allowedValues: strAllowedValues,
                        defaultValue: strDefaultValue,
                        minimum: strMinimum,
                        maximum: strMaximum,
                        step: strStep,
                    }
                }
            });
        }//END for
    } catch (err) {
    }
    //END Add serviceList for SubDevice

} //END function

function createActionList(result, service) {
    if (!result || !result.scpd || !result.scpd.actionList || !result.scpd.actionList[0]) {
        return;
    }

    let path = result.scpd.actionList[0];
    if (!path.action || !path.action.length) {
        return;
    }
    let actionLen = path.action.length;

    //Counting action's
    //adapter.log.debug('Number of actions: ' + actionLen);

    for (let i2 = actionLen - 1; i2 >= 0; i2--) {
        let xmlName = getValueFromArray(path.action[i2].name);
        addTask({
            name: 'setObjectNotExists',
            id: `${service}.${xmlName}`,
            obj: {
                type: 'channel',
                common: {
                    name: xmlName
                },
                native: {
                    name: xmlName
                }
            }
        });

        try {
            createArgumentList(result, service, xmlName, i2, path);
        } catch (err) {
            adapter.log.debug(`There is no argument for ${xmlName}`);
        }
    }
}

function createArgumentList(result, service, actionName, action_number, path) {
    let iLen = 0;
    let action;
    let _arguments;
    // adapter.log.debug('Reading argumentList for ' + actionName);

    action = path.action[action_number].argumentList;
    if (action && action[0] && action[0].argument) {
        _arguments = action[0].argument;
        iLen = _arguments.length;
    } else {
        return;
    }

    addTask({
        name: 'setObjectNotExists',
        id: `${service}.${actionName}.request`,
        obj: {
            type: 'state',
            common: {
                name: 'Initiate poll',
                role: 'button',
                type: 'boolean',
                def: false,
                read: false,
                write: true
            },
            native: {
                actionName: actionName,
                service: service,
                request: true
            }
        }
    }); //END adapter.setObject()

    // Counting arguments's
    for (let i2 = iLen - 1; i2 >= 0; i2--) {
        let xmlName = 'Unknown';
        let xmlDirection = '';
        let xmlRelStateVar = '';
        let argument = _arguments[i2];

        try {
            xmlName = getValueFromArray(argument.name);
        } catch (err) {
            adapter.log.debug(`Can not read argument "name" of ${actionName}`);
        }

        try {
            xmlDirection = getValueFromArray(argument.direction);
        } catch (err) {
            adapter.log.debug(`Can not read direction of ${actionName}`);
        }

        try {
            xmlRelStateVar = getValueFromArray(argument.relatedStateVariable);
        } catch (err) {
            adapter.log.debug(`Can not read relatedStateVariable of ${actionName}`);
        }
        addTask({
            name: 'setObjectNotExists',
            id: `${service}.${actionName}.${xmlName}`,
            obj: {
                type: 'state',
                common: {
                    name: xmlName,
                    role: 'state.argument.' + xmlDirection,
                    type: 'string',
                    def: '',
                    read: true,
                    write: true
                },
                native: {
                    direction: xmlDirection,
                    relatedStateVariable: xmlRelStateVar,
                    argumentNumber: i2 + 1,
                    name: xmlName,
                }
            }
        }); //END adapter.setObject()
    }
} //END function
//END Creating argumentList

let showTimer = null;
function processTasks(cb) {
    if (!taskRunning && tasks.length) {
        if (cb) {
            globalCb = cb; // used by unload
        }

        taskRunning = true;
        setImmediate(_processTasks);
        adapter.log.debug('Started processTasks with ' + tasks.length + ' tasks');
        showTimer = setInterval(() => adapter.log.debug(`Tasks ${tasks.length}...`), 5000);
    } else if (cb) {
        cb();
    }
}

function addTask(task) {
    tasks.push(task);
}

function _processTasks() {
    if (!tasks.length) {
        taskRunning = false;
        adapter.log.debug('All tasks processed');
        clearInterval(showTimer);
        if (globalCb) {
            globalCb();
            globalCb = null;
        }
    } else {
        const task = tasks.shift();
        if (task.name === 'sendCommand') {
            sendCommand(task.id, () => setTimeout(_processTasks, 0));
        } else
        if (task.name === 'firstDevLookup') {
            firstDevLookup(task.location, () => setTimeout(_processTasks, 0));
        } else
        if (task.name === 'subscribeEvent') {
            subscribeEvent(task.deviceID, () => setTimeout(_processTasks, 0));
        } else if (task.name === 'setState') {
            adapter.setState(task.id, task.state, err => {
                if (typeof task.cb === 'function') {
                    task.cb(() => setTimeout(_processTasks, 0));
                } else {
                    setTimeout(_processTasks, 0);
                }
            });
        } else
        if (task.name === 'valChannel') {
            valChannel(task.strState, task.serviceID, () => {
                writeState(task.serviceID, task.stateName, task.val, () =>
                    setTimeout(_processTasks, 0));
            });

        } else
        if (task.name === 'readSCPD') {
            readSCPD(task.SCPDlocation, task.service, () => setTimeout(_processTasks, 0));
        } else
        if (task.name === 'setObjectNotExists') {
            if(task.obj.common.type){
                switch (task.obj.common.type){
                    case 'bool':
                        task.obj.common.type = 'boolean';
                        break;
                    case 'i1':
                    case 'i2':
                    case 'i4':
                    case 'ui1':
                    case 'ui2':
                    case 'ui4':
                    case 'int':
                    case 'r4':
                    case 'r8':
                    case 'fixed.14.4':
                    case 'fixed':
                    case 'float':
                        task.obj.common.type = 'number';
                        break;
                    case 'char string':
                    case 'date':
                    case 'dateTime':
                    case 'dateTime.tz':
                    case 'time':
                    case 'time.tz':
                    case 'bin.base64':
                    case 'bin.hex':
                    case 'uri':
                    case 'uuid':
                        task.obj.common.type = 'string';
                        break;
                }
                if(task.obj.common.name === 'bool'){
                    task.obj.common.name = 'boolean';
                }
            }
            adapter.setObjectNotExists(task.id, task.obj, () => {
                if (task.obj.type === 'state' && task.id.match(/\.sid$/)) {
                    adapter.getState(task.id, (err, state) => {
                        if (!state) {
                            adapter.setState(task.id, false, true, (err, state) =>
                                setTimeout(_processTasks, 0));
                        } else {
                            setTimeout(_processTasks, 0);
                        }
                    });
                } else {
                    setTimeout(_processTasks, 0);
                }
            });
        } else {
            adapter.log.warn('Unknown task: ' + task.name);
            setTimeout(_processTasks, 0);
        }
    }
}

function startServer() {
    //START Server for Alive and ByeBye messages
// let own_uuid = 'uuid:f40c2981-7329-40b7-8b04-27f187aecfb5'; //this string is for filter message's from upnp Adapter
    let server = new Server({ssdpIp: '239.255.255.250'});
    // helper variables for start adding new devices
    // let devices;
    // Identification of upnp Adapter/ioBroker as upnp Service and it's capabilities
    // at this time there is no implementation of upnp service capabilities, it is only necessary for the server to run
    server.addUSN('upnp:rootdevice');
    server.addUSN('urn:schemas-upnp-org:device:IoTManagementandControlDevice:1');


    server.on('advertise-alive', headers => {
        let usn = getValueFromArray(headers['USN'])
            .replace(/uuid:/ig, '')
            .replace(/::.*/ig, '');

        let nt = getValueFromArray(headers['NT']);
        let location = getValueFromArray(headers['LOCATION']);
        if (!usn.match(/f40c2981-7329-40b7-8b04-27f187aecfb5/)) {
            if (discoveredDevices.indexOf(location) === -1) {
                discoveredDevices.push(location);

                adapter.getDevices((err, devices) => {
                    let foundUUID = false;
                    for (let i = 0; i < devices.length; i++) {
                        if (!devices[i] || !devices[i].native || !devices[i].native.uuid) continue;
                        const deviceUUID = devices[i].native.uuid;
                        const deviceUSN = devices[i].native.deviceType;
                        // Set object Alive for the Service true
                        if (deviceUUID === usn && deviceUSN === nt) {
                            let maxAge = getValueFromArray(headers['CACHE-CONTROL'])
                                .replace(/max-age.=./ig, '')
                                .replace(/max-age=/ig, '')
                                .replace(/"/g, '');
                            addTask({
                                name: 'setState',
                                id: `${devices[i]._id}.Alive`,
                                state: {val: true, ack: true, expire: parseInt(maxAge)}
                            });
                            addTask({name: 'subscribeEvent', deviceID: devices[i]._id});
                        }
                        if (deviceUUID === usn) {
                            foundUUID = true;
                            break;
                        }
                    }

                    if (!foundUUID && adapter.config.enableAutoDiscover) {
                        adapter.log.debug(`Found new device: ${location}`);
                        addTask({name: 'firstDevLookup', location});
                    } else {
                        const pos = discoveredDevices.indexOf(location);
                        pos !== -1 && discoveredDevices.splice(pos, 1);
                    }
                    processTasks();
                });
            }

        }
    });

    server.on('advertise-bye', headers => {
        let usn = JSON.stringify(headers['USN']);
        usn = usn.toString();
        usn = usn.replace(/uuid:/g, '');
        try {
            usn.replace(/::.*/ig, '')
        } catch (err) {
        }
        // let nt = JSON.stringify(headers['NT']);
        // let location = JSON.stringify(headers['LOCATION']);
        if (!usn.match(/.*f40c2981-7329-40b7-8b04-27f187aecfb5.*/)) {
            adapter.getDevices((err, devices) => {
                let device;
                let deviceID;
                let deviceUUID;
                let deviceUSN;
                for (device in devices) {
                    if (!devices.hasOwnProperty(device)) continue;
                    deviceUUID = JSON.stringify(devices[device]['native']['uuid']);
                    deviceUSN = JSON.stringify(devices[device]['native']['deviceType']);
                    //Set object Alive for the Service false
                    if (deviceUUID === usn) {
                        deviceID = JSON.stringify(devices[device]._id);
                        deviceID = deviceID.replace(/"/ig, '');
                        addTask({
                            name: 'setState',
                            id: `${deviceID}.Alive`,
                            state: {val: false, ack: true}
                        });
                    }
                }
                processTasks();
            }); //END adapter.getDevices()
        }
    });

    setTimeout(() => server.start(), 15000);
}

// Subscribe to every service that is alive. Triggered by change alive from false/null to true.
async function subscribeEvent(id, cb) {
    const service = id.replace(/\.Alive/ig, '');
    if (adapter.config.enableAutoSubscription === true) {
        adapter.getObject(service, (err, obj) => {
            let deviceIP = obj.native.ip;
            let devicePort = obj.native.port;
            const parts = obj._id.split('.');
            parts.pop();
            const channelID = parts.join('.');

            adapter.getChannelsOf(channelID, async (err, channels) => {
                for (let x = channels.length - 1; x >= 0; x--) {
                    const eventUrl = getValueFromArray(channels[x].native.eventSubURL).replace(/"/g, '');
                    if(channels[x].native.serviceType) {
                        try {
                            const infoSub = new Subscription(deviceIP, devicePort, eventUrl, 1000);
                            listener(eventUrl, channels[x]._id, infoSub);
                        } catch (err) {
                        }
                    }
                }
                cb();
            }); //END adapter.getChannelsOf()
        }); //END adapter.getObjects()
    } else {
        cb();
    }
}

// message handler for subscriptions
function listener(eventUrl, channelID, infoSub) {
    let variableTimeout;
    let resetTimeoutTimer;

    infoSub.on('subscribed', data => {
        variableTimeout += 5;
        setTimeout(() => adapter.setState(channelID + '.sid', {val: ((data && data.sid) || '').toString(), ack: true}), variableTimeout);

        resetTimeoutTimer && clearTimeout(resetTimeoutTimer);
        resetTimeoutTimer = setTimeout(() => {
            variableTimeout = 0;
            resetTimeoutTimer = null;
        }, 100);
    });

    infoSub.on('message', data => {
        adapter.log.debug('Listener message: ' + JSON.stringify(data));
        variableTimeout += 5;

        setTimeout(() =>
            getIDs()
                .then(result => lookupService(data, JSON.parse(JSON.stringify(result.sids))))
            ,variableTimeout);

        resetTimeoutTimer && clearTimeout(resetTimeoutTimer);
        resetTimeoutTimer = setTimeout(() => {
            variableTimeout = 0;
            resetTimeoutTimer = null;
        }, 100);
    });

    infoSub.on('error', err => {
        adapter.log.debug(`Subscription error: ` + JSON.stringify(err));
        // subscription.unsubscribe();
    });

    infoSub.on('resubscribed', data => {
        // adapter.log.info('SID: ' + JSON.stringify(sid) + ' ' + eventUrl + ' ' + _channel._id);
        variableTimeout += 5;

        setTimeout(() => adapter.setState(channelID + '.sid', {val: ((data && data.sid) || '').toString(), ack: true}), variableTimeout);

        resetTimeoutTimer && clearTimeout(resetTimeoutTimer);
        resetTimeoutTimer = setTimeout(() => {
            variableTimeout = 0;
            resetTimeoutTimer = null;
        }, 100);
    });
}

function lookupService(data, SIDs, cb) {
    if (!SIDs || !SIDs.length || !data || !data.sid) {
        cb && cb();
    } else {
        const id = SIDs.shift();

        adapter.getState(id, (err, state) => {
            if (err || !state || typeof state !== 'object') {
                adapter.log.error(`Error in lookupService: ${err || 'No object ' + id}`);
                setImmediate(lookupService, data, cb);
            } else {
                setNewState(state, id.replace(/\.sid$/, ''), data, () =>
                    setImmediate(lookupService, data, cb));
            }
        });
    }
}

function setNewState(state, serviceID, data, cb) {
    adapter.log.debug('setNewState: ' + state + ' ' + JSON.stringify(data));
    // Extract the value of the state
    let valueSID = state.val;

    if (valueSID !== null && valueSID !== undefined) {
        valueSID = valueSID.toString().toLowerCase();
        if (valueSID.indexOf(data.sid.toString().toLowerCase()) !== -1) {
            serviceID = serviceID.replace(/\.sid$/, '');
            // Select sub element with States
            let newStates = data.body['e:propertyset']['e:property'];

            if (newStates && newStates.LastChange && newStates.LastChange._) {
                newStates = newStates.LastChange._;
                adapter.log.info('Number 1: ' + newStates);
            } else if (newStates) {
                newStates = newStates.LastChange;
                adapter.log.info('Number 2: ' + newStates);
            } else {
                adapter.log.info('Number 3: ' + newStates);
            }

            let newStates2 = JSON.stringify(newStates) || '';

            // TODO: Must be refactored
            if (newStates2 === undefined){
                adapter.log.info('State: ' + state + ' Service ID: ' + serviceID + ' Data: ' + JSON.stringify(data));
            }else if (newStates2.match(/<Event.*/ig)) {
                parseString(newStates, (err, result) => {
                    let states = convertEventObject(result['Event']);
                    // split every array member into state name and value, then push it to ioBroker state
                    let stateName;
                    let val;
                    if (states) {
                        for (let x = states.length - 1; x >= 0; x--) {
                            let strState = states[x].toString();
                            stateName = strState.match(/"\w*/i);
                            stateName = stateName ? stateName[0] : strState;
                            stateName = stateName.replace(/"/i, '');

                            // looking for the value
                            val = strState.match(/val":"(\w*(:\w*|,\s\w*)*)/ig);
                            if (val) {
                                val = val[0];
                                val = val.replace(/val":"/ig, '');
                            }

                            addTask({name: 'valChannel', strState, serviceID, stateName, val});
                        }
                        processTasks();
                    }
                    cb();
                }); //END parseString()
            } else if (newStates2.match(/"\$":/ig)) {
                let states = convertWM(newStates);

                // split every array member into state name and value, then push it to ioBroker state
                if (states) {
                    let stateName;
                    for (let z = states.length - 1; z >= 0; z--) {
                        let strState = states[z].toString();
                        stateName = strState.match(/"\w*/i);
                        stateName = stateName ? stateName[0] : strState;
                        stateName = stateName.replace(/^"|"$/g, '');

                        addTask({name: 'valChannel', strState, serviceID, stateName, val: valLookup(strState)});
                    }
                    processTasks();
                }
                cb();
            } else {
                // Read all other messages and write the states to the related objects
                let states = convertInitialObject(newStates);

                if (states) {
                    // split every array member into state name and value, then push it to ioBroker state
                    let stateName;
                    for (let z = states.length - 1; z >= 0; z--) {
                        let strState = states[z].toString();
                        stateName = strState.match(/"\w*/i);
                        stateName = stateName ? stateName[0] : strState;
                        stateName = stateName.replace(/^"|"$/g, '');

                        addTask({name: 'valChannel', strState, serviceID, stateName, val: valLookup(strState)});
                    }
                    processTasks();
                }
                cb();
            }
        } else {
            cb();
        }
    } else {
        cb();
    }
}

// write state
function writeState(sID, sname, val, cb) {
    adapter.getObject(`${sID}.A_ARG_TYPE_${sname}`, (err, obj) => {
        if (obj) {
            if(obj.common.type === 'number'){
                val = parseInt(val);
            }
            adapter.setState(`${sID}.A_ARG_TYPE_${sname}`, {val: val, ack: true}, err => {
                adapter.getObject(`${sID}.${sname}`, (err, obj) => {
                    if (obj) {
                        adapter.setState(`${sID}.${sname}`, {val: val, ack: true}, cb);
                    } else {
                        cb();
                    }
                });
            });
        } else {
            adapter.getObject(`${sID}.${sname}`, (err, obj) => {
                if (obj) {
                    if(obj.common.type === 'number'){
                        val = parseInt(val);
                    }
                    adapter.setState(`${sID}.${sname}`, {val: val, ack: true}, cb);
                } else {
                    cb();
                }
            });
        }
    });
}

// looking for the value of channel
function valChannel(strState, serviceID, cb) {
    //looking for the value of channel
    let channel = strState.match(/channel":"(\w*(:\w*|,\s\w*)*)/ig);
    if (channel) {
        channel = channel.toString();
        channel = channel.replace(/channel":"/ig, '');
        adapter.setState(`${serviceID}.A_ARG_TYPE_Channel`, {val: channel, ack: true}, cb);
    } else {
        cb()
    }
}

// looking for the value
function valLookup(strState) {
    let val = strState.match(/\w*":"(\w*\D\w|\w*|,\s\w*|(\w*:)*(\*)*(\/)*(,)*(-)*(\.)*)*/ig);
    if (val) {
        val = val.toString();
        val = val.replace(/"\w*":"/i, '');
        val = val.replace(/"/ig, '');
        val = val.replace(/\w*:/, '')
    }
    return val;
}

// Not used now
// function convertEvent(data){
//     let change = data.replace(/<\\.*>/ig, '{"');
//     change = data.replace(/</ig, '{"');
//     change = change.replace(/\s/ig, '""');
//     change = change.replace(/=/ig, ':');
//     change = change.replace(/\\/ig, '');
//     change = change.replace(/>/ig, '}');
// }

//convert the event JSON into an array
function convertEventObject(result) {
    const regex = new RegExp(/"\w*":\[{"\$":{("\w*":"(\w*:\w*:\w*|(\w*,\s\w*)*|\w*)"(,"\w*":"\w*")*)}/ig);
    return (JSON.stringify(result) || '').match(regex);
}

//convert the initial message JSON into an array
function convertInitialObject(result) {
    const regex = new RegExp(/"\w*":"(\w*|\w*\D\w*|(\w*-)*\w*:\w*|(\w*,\w*)*|\w*:\S*\*)"/g);
    return (JSON.stringify(result) || '').match(regex);
}

//convert the initial message JSON into an array for windows media player/server
function convertWM(result) {
    const regex = new RegExp(/"\w*":{".":"(\w*"|((http-get:\*:\w*\/((\w*\.)*|(\w*-)*|(\w*\.)*(\w*-)*)\w*:\w*\.\w*=\w*(,)*)*((http-get|rtsp-rtp-udp):\*:\w*\/(\w*(\.|-))*\w*:\*(,)*)*))/g);
    return (JSON.stringify(result) || '').match(regex);
}

//END Event listener

// clear Alive and sid's states when Adapter stops
function clearAliveAndSIDStates(cb) {
    // Clear sid
    getIDs()
        .then(result => {
            result.sids.forEach(id => {
                addTask({name: 'setState', id, state: {val: '', ack: true}});
            });
            result.alives.forEach(id => {
                addTask({name: 'setState', id, state: {val: false, ack: true}});
            });
            processTasks(cb);
        });
}

function getIDs() {
    if (sidPromise) {
        return sidPromise;
    } else {
        // Fill array arrSID if it is empty
        sidPromise = new Promise(resolve => {
            adapter.getStatesOf(`upnp.${adapter.instance}`, (err, _states) => {
                const sids = [];
                const alives = [];
                err && adapter.log.error('Cannot get SIDs: ' + err);
                if (_states) {
                    _states.forEach(obj => {
                        if (obj._id.match(/\.sid$/)) {
                            // if the match deliver an id of an object add them to the array
                            sids.push(obj._id);
                        } else
                        if (obj._id.match(/\.Alive/g)) {
                            alives.push(obj._id);
                        }
                    });
                }

                // adapter.log.debug('Array arrSID is now filled');
                // When the array is filled start the search
                resolve({sids, alives});
            });
        });
        return sidPromise;
    }
}

// control the devices
function sendCommand(id, cb) {
    adapter.log.debug('Send Command for ' + id);
    let parts = id.split('.');
    parts.pop();
    let actionName = parts.pop();
    let service = parts.join('.');
    id = id.replace('.request', '');

    adapter.getObject(service, (err, obj) => {

        let vServiceType = obj.native.serviceType;
        let serviceName = obj.native.name;
        let device = service.replace(`.${serviceName}`, '');
        let vControlURL = obj.native.controlURL;

        adapter.getObject(device, (err, obj) => {
            let ip = obj.native.ip;
            let port = obj.native.port;
            let cName = JSON.stringify(obj._id);
            cName = cName.replace(/\.\w*"$/g, '');
            cName = cName.replace(/^"/g, '');

            adapter.getStatesOf(cName, (err, _states) => {
                let args = [];

                for (let x = _states.length - 1; x >= 0; x--) {
                    let argumentsOfAction = _states[x]._id;
                    let obj = _states[x];
                    let test2 = id + '\\.';
                    try {
                        test2 = test2.replace(/\(/gi, '.');
                    } catch (err) {
                        adapter.log.debug(err)
                    }
                    try {
                        test2 = test2.replace(/\)/gi, '.');
                    } catch (err) {
                        adapter.log.debug(err)
                    }
                    try {
                        test2 = test2.replace(/\[/gi, '.');
                    } catch (err) {
                        adapter.log.debug(err)
                    }
                    try {
                        test2 = test2.replace(/ ]/gi, '.');
                    } catch (err) {
                        adapter.log.debug(err)
                    }
                    let re = new RegExp(test2, 'g');
                    let testResult = re.test(argumentsOfAction);
                    if (testResult && argumentsOfAction !== id) {
                        args.push(obj);
                    }
                }

                let body = '';

                // get all states of the arguments as string
                adapter.getStates(`${id}.*`, (err, idStates) => {
                    adapter.log.debug('get all states of the arguments as string ');
                    let helperBody = [];
                    let states = JSON.stringify(idStates);
                    states = states.replace(/,"ack":\w*,"ts":\d*,"q":\d*,"from":"(\w*\.)*(\d*)","lc":\d*/g, '');

                    for (let z = args.length - 1; z >= 0; z--) {
                        // check if the argument has to be send with the action
                        if (args[z].native.direction === 'in') {
                            let argNo = args[z].native.argumentNumber;

                            // check if the argument is already written to the helperBody array, if not found value and add to array
                            if (helperBody[argNo] == null) {

                                let test2 = getValueFromArray(args[z]._id);
                                // replace signs that could cause problems with regex
                                test2 = test2
                                    .replace(/\(/gi, '.')
                                    .replace(/\)/gi, '.')
                                    .replace(/\[/gi, '.')
                                    .replace(/]/gi, '.');

                                let test3 = test2 + '":{"val":("[^"]*|\\d*)}?';
                                let patt = new RegExp(test3, 'g');

                                let testResult2;

                                let testResult = states.match(patt);
                                testResult2 = JSON.stringify(testResult);
                                testResult2 = testResult2.match(/val\\":(\\"[^"]*|\d*)}?/g);
                                testResult2 = JSON.stringify(testResult2);
                                testResult2 = testResult2.replace(/\["val(\\)*":(\\)*/, '');
                                testResult2 = testResult2.replace(/]/, '');
                                testResult2 = testResult2.replace(/}"/, '');
                                testResult2 = testResult2.replace(/"/g, '');


                                //extract argument name from id string
                                let test1 = args[z]._id;
                                let argName = test1.replace(`${id}\.`, '');

                                helperBody[argNo] = '<' + argName + '>' + testResult2 + '</' + argName + '>';
                            }
                        }
                    }

                    //convert helperBody array to string and add it to main body string
                    helperBody = helperBody.toString().replace(/,/g, '');
                    body += helperBody;
                    body = `<u:${actionName} xmlns:u="${vServiceType}">${body}</u:${actionName}>`;

                    createMessage(vServiceType, actionName, ip, port, vControlURL, body, id, cb);
                });
            })
        });
    });
}

function readSchedules() {
    return new Promise(resolve => {
       adapter.getObjectView('system', 'custom', {startkey: adapter.namespace + '.', endkey: adapter.namespace + '.\uFFFF'}, (err, doc) => {
            if (doc && doc.rows) {
                for (let i = 0, l = doc.rows.length; i < l; i++) {
                    if (doc.rows[i].value) {
                        let id = doc.rows[i].id;
                        let obj = doc.rows[i].value;
                        if (id.startsWith(adapter.namespace) && obj[adapter.namespace] && obj[adapter.namespace].enabled && id.match(/\.request$/)) {
                            actions[id] = {cron: obj[adapter.namespace].schedule};
                        }
                    }
                }
            }
            resolve();
        });
    });
}

// create Action message
function createMessage(sType, aName, _ip, _port, cURL, body, actionID, cb) {
    const UA = 'UPnP/1.0, ioBroker.upnp';
    let url = `http://${_ip}:${_port}${cURL}`;

    const contentType = 'text/xml; charset="utf-8"';
    let soapAction = `${sType}#${aName}`;
    let postData = ` 
        <s:Envelope s:encodingStyle=\"http://schemas.xmlsoap.org/soap/encoding/\" xmlns:s=\"http://schemas.xmlsoap.org/soap/envelope/\">
            <s:Body>${body}</s:Body>
        </s:Envelope>`;

    //Options for the SOAP message
    let options = {
        uri: url,
        headers: {
            'Content-Type': contentType,
            'SOAPAction': `"${soapAction}"`,
            'USER-AGENT': UA
        },
        method: 'POST',
        body: postData
    };

    // Send Action message to Device/Service
    request(options, (err, res, body) => {
        adapter.log.debug('Options for request: ' + JSON.stringify(options));
        if (err) {
            adapter.log.warn(`Error sending SOAP request: ${err}`);
        } else {
            if (res.statusCode !== 200) {
                adapter.log.warn(`Unexpected answer from upnp service: ` + JSON.stringify(res) + `\n Sent message: ` + JSON.stringify(options));
            } else {
                //look for data in the response
                // die Zusätlichen infos beim Argument namen müssen entfernt werden damit er genutzt werden kann
                let foundData = body.match(/<[^\/]\w*\s*[^<]*/g);
                if (foundData) {
                    actionID = actionID.replace(/\.request$/, '');

                    for (let i = foundData.length - 1; i >= 0; i--) {
                        let foundArgName = foundData[i].match(/<\w*>/);
                        let strFoundArgName;
                        let argValue;
                        if (foundArgName) {
                            strFoundArgName = foundArgName[0];
                            // TODO: must be rewritten
                            strFoundArgName = strFoundArgName.replace(/["\][]}/g, '');
                            argValue = foundData[i].replace(strFoundArgName, '');
                            strFoundArgName = strFoundArgName.replace(/[<>]/g, '');
                        } else {
                            foundArgName = foundData[i].match(/<\w*\s/);
                            if (foundArgName) {
                                // TODO: must be rewritten
                                strFoundArgName = foundArgName[0];
                                strFoundArgName = strFoundArgName.replace(/["[\]<]/g, '').replace(/\s+$/, '');
                                argValue = foundData[i].replace(/<.*>/, '');
                            }
                        }

                        if (strFoundArgName !== null && strFoundArgName !== undefined) {
                            let argID = actionID + '.' + strFoundArgName;
                            addTask({
                                name: 'setState',
                                id: argID,
                                state: {val: argValue, ack: true},
                                cb: cb =>
                                    //look for relatedStateVariable and setState
                                    syncArgument(actionID, argID, argValue, cb)
                            });
                        }
                    }
                    processTasks();
                } else {
                    adapter.log.debug('Nothing found: ' + JSON.stringify(body));
                }
            }
        }
        cb && cb();
    });
}

// Sync Argument with relatedStateVariable
function syncArgument(actionID, argID, argValue, cb) {
    adapter.getObject(argID, (err, obj) => {
        if (obj) {
            let relatedStateVariable = obj.native.relatedStateVariable;
            let serviceID = actionID.replace(/\.\w*$/, '');
            let relStateVarID = serviceID + '.' + relatedStateVariable;
            let val = argValue;
            if(obj.common.type === 'number'){
                val = parseInt(argValue);
            }
            adapter.setState(relStateVarID, {val: argValue, ack: true}, cb);
        } else {
            cb && cb();
        }
    });
}

function nameFilter(name) {
    if (typeof name === 'object' && name[0]) {
        name = name[0];
    }
    let signs = [
        String.fromCharCode(46),
        String.fromCharCode(44),
        String.fromCharCode(92),
        String.fromCharCode(47),
        String.fromCharCode(91),
        String.fromCharCode(93),
        String.fromCharCode(123),
        String.fromCharCode(125),
        String.fromCharCode(32),
        String.fromCharCode(129),
        String.fromCharCode(154),
        String.fromCharCode(132),
        String.fromCharCode(142),
        String.fromCharCode(148),
        String.fromCharCode(153),
        String.fromCharCode(42),
        String.fromCharCode(63),
        String.fromCharCode(34),
        String.fromCharCode(39),
        String.fromCharCode(96)
    ];
    //46=. 44=, 92=\ 47=/ 91=[ 93=] 123={ 125=} 32=Space 129=ü 154=Ü 132=ä 142=Ä 148=ö 153=Ö 42=* 63=? 34=" 39=' 96=`

    signs.forEach((item, index) => {
        let count = name.split(item).length - 1;

        for (let i = 0; i < count; i++) {
            name = name.replace(item, '_');
        }

        let result = name.search(/_$/);
        if (result !== -1) {
            name = name.replace(/_$/, '');
        }
    });
    name = name.replace(/[*\[\]+?]+/g, '_');
    return name;
}

function main() {
    adapter.subscribeStates('*');
    adapter.subscribeObjects('*');

    adapter.log.info('Auto discover: ' + adapter.config.enableAutoDiscover);

    readSchedules()
        .then(() => {
            if (adapter.config.enableAutoDiscover === true) {
                sendBroadcast();
            }

            // read SIDs and Alive IDs
            getIDs()
                .then(result => {
                    adapter.log.debug(`Read ${result.sids.length} SIDs and ${result.alives.length} alives`);

                    // Filtering the Device description file addresses, timeout is necessary to wait for all answers
                    setTimeout(() => {
                        adapter.log.debug(`Found ${foundIPs.length} devices`);
                        if (adapter.config.rootXMLurl) {
                            firstDevLookup(adapter.config.rootXMLurl);
                        }
                        reschedule();
                    }, 5000);

                    //start the server
                    startServer();
                });
        });
}

// If started as allInOne mode => return function to create instance
if (module.parent) {
    module.exports = startAdapter;
} else {
    // or start the instance directly
    startAdapter();
}

