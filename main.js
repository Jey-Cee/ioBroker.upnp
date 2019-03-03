'use strict';

// you have to require the utils module and call adapter function
const utils = require('@iobroker/adapter-core'); // Get common adapter utils

//include node-ssdp and node-upnp-subscription
const Client = require('node-ssdp').Client;
let client = new Client();
const Subscription = require(__dirname + '/lib/upnp-subscription');
const parseString = require('xml2js').parseString;
const request = require('request');

//include Upnp Player
const player = require(__dirname + '/lib/player');

const adapter = utils.Adapter('upnp');

// is called when adapter shuts down - callback has to be called under any circumstances!
adapter.on('unload', function (callback) {
    try {

        stop_server();
        clearAsStates();
        adapter.log.info('cleaned everything up...');
        callback();
    } catch (e) {
        callback();
    }
});

// is called if a subscribed object changes
adapter.on('objectChange', function (id, obj) {
    // Warning, obj can be null if it was deleted
    adapter.log.debug('objectChange ' + id + ' ' + JSON.stringify(obj));
});

// is called if a subscribed state changes
adapter.on('stateChange', function (id, state) {
    // Warning, state can be null if it was deleted

    //Subscribe to an service when its state Alive is true
    let lastChange;
    const patt = new RegExp(/\.Alive/g);
    let testAlive =  patt.test(id);
    if (testAlive === true) {
        adapter.getState(id, function (err, obj) {
            try {
                lastChange = obj['lc'];
            } catch (err) {
            }
            let d = new Date();
            let timeNow = d.getTime();
            let diff = timeNow - lastChange;
            if (diff <= 10) {
                subscribe_event(id, state)
            }
        });
        adapter.getState(id, function(err, state){
            //var value = state.val
                //player.setAvailablePlayers(id, value);
        })
    }

    //Upnp Player controls
    const patt2 = new RegExp(/\.Player\./g);
    let testPlayer = patt2.test(id);
    if (testPlayer === true){
        try {
            player.main(id, state);
        }catch(err){}
    }

    //Control a device when a related object changes its value
    adapter.getObject(id, function (err, obj) {
        try {
            if (obj.common.role == 'action'){
                adapter.getState(id, function (err, state) {
                    if (state['val'] === 'send') {
                        sendCommand(obj);
                    }

                });
            }

        } catch (err) {

        }

    });


    // you can use the ack flag to detect if it is status (true) or command (false)
    if (state && !state.ack) {
        //adapter.log.info('ack is not set!');
    }
});


// is called when databases are connected and adapter received configuration.
// start here!
adapter.on('ready', function(){
    if(adapter.config.enableSimplePlayerControls) {
        player.getAdapter(adapter);
        player.createPlayerStates();
    }
    main();
});

// Some message was sent to adapter instance over message box. Used by email, pushover, text2speech, ...
adapter.on('message', function (obj) {
    if (typeof obj == 'object' && obj.message) {
        if (obj.command == 'send') {
            // e.g. send email or pushover or whatever
            adapter.log.info('send command');

            // Send response in callback if required
            if (obj.callback) adapter.sendTo(obj.from, obj.command, 'Message received', obj.callback);
        }
    }
});

let foundIPs = []; // Array for the caught broadcast answers
let arrAlive = [];


function main() {
    adapter.subscribeStates('*');

    adapter.log.info('Auto discover: ' + adapter.config.enableAutoDiscover);

    if (adapter.config.enableAutoDiscover === true) {
        sendBroadcast();
    }

    //Filtering the Device description file addresses, timeout is necessary to wait for all answers
    setTimeout(function () {
        adapter.log.debug("Found " + foundIPs.length + " devices");
        if(adapter.config.rootXMLurl != '' && adapter.config.rootXMLurl != null) {
            firstDevLookup(adapter.config.rootXMLurl);
        }
    }, 5000);

    createAliveArr();

}

function sendBroadcast() {
    //adapter.log.debug("Send Broadcast");

    //Sends a Broadcast and catch the URL with xml device description file
    client.on('response', function (headers, statusCode, rinfo) {
        let strHeaders = JSON.stringify(headers, null, ' ');
        let jsonAnswer = JSON.parse(strHeaders);
        let answer = jsonAnswer.LOCATION;

        if (foundIPs.indexOf(answer) === -1) {
            foundIPs.push(answer);


            if (answer != answer.match(/.*dummy.xml/g)) {
                setTimeout(function () {
                    firstDevLookup(answer);
                }, 1000);
            }
        }
    });
    if (adapter.config.enableAutoDiscover === true) {
        client.search('ssdp:all');
    }

}

//START Reading the xml device description file of each upnp device the first time
function firstDevLookup(strLocation) {

    adapter.log.debug("firstDevLookup for " + strLocation);

    request(strLocation, function (error, response, body) {
        if (!error && response.statusCode == 200) {
            adapter.log.debug("Positive answer for request of the XML file for " + strLocation);


            try {
                parseString(body, {
                        explicitArray: true,
                        mergeAttrs: true
                    },
                    function (err, result) {
                        let path;
                        let xmlDeviceType;
                        let xmlTypeOfDevice;
                        let xmlUDN;
                        let xmlManufacturer;

                        adapter.log.debug("Parsing the XML file for " + strLocation);

                        if (err) {
                            adapter.log.warn("Error: " + err);
                        } else {
                            adapter.log.debug("Creating objects for " + strLocation);
                            let i;

                            if (!result || !result.root || !result.root.device) {
                                adapter.log.debug('Error by parsing of ' + strLocation + ': Cannot find deviceType');
                                return;
                            }

                            path = result.root.device[0];
                            //Looking for deviceType of device
                            try {
                                xmlDeviceType = path.deviceType;
                                xmlDeviceType = xmlDeviceType.toString().replace(/"/g, "");
                                xmlTypeOfDevice = xmlDeviceType.toString().replace(/:\d/, "");
                                xmlTypeOfDevice = xmlTypeOfDevice.replace(/.*:/, "");
                                xmlTypeOfDevice = nameFilter(xmlTypeOfDevice);
                                adapter.log.debug("TypeOfDevice " + xmlTypeOfDevice);
                            } catch (err) {
                                adapter.log.debug(`Can not read deviceType of ${strLocation}`);
                                xmlDeviceType = "";
                            }

                            //Looking for the port
                            let strPort = strLocation.replace(/\bhttp:\/\/.*\d:/ig, "");
                            strPort = strPort.replace(/\/.*/ig, "");
                            if (strPort.match(/http:/ig) == true) {strPort = '';}


                            //Looking for the IP of a device
                            strLocation = strLocation.replace(/http:\/\//g, "");
                            try {
                                strLocation = strLocation.replace(/:\d*\/.*/ig, "");
                            } catch (err) {
                                strLocation = strLocation.replace(/\/\w.*/ig, "");
                            }

                            //Looking for UDN of a device
                            try {
                                xmlUDN = path.UDN;
                                xmlUDN = xmlUDN.toString().replace(/"/g, "");
                                xmlUDN = xmlUDN.replace(/uuid:/g, "");
                            } catch (err) {
                                adapter.log.debug(`Can not read UDN of ${strLocation}`);
                                xmlUDN = '';
                            }

                            //Looking for the manufacturer of a device
                            try {
                                xmlManufacturer = path.manufacturer;
                                xmlManufacturer = xmlManufacturer.toString().replace(/"/g, '');
                            } catch (err) {
                                adapter.log.debug("Can not read manufacturer of " + strLocation);
                                xmlManufacturer = "";
                            }

                            //Extract the path to the device icon that is delivered by the device
                            let i_icons = 0;
                            let xmlIconURL;
                            let xmlFriendlyName;
                            let xmlFN;
                            let xmlManufacturerURL;
                            let xmlModelNumber;
                            let xmlModelDescription;
                            let xmlModelName;
                            let xmlModelURL;

                            try {
                                i_icons = path.iconList[0].icon.length;

                                xmlIconURL = path.iconList[0].icon[0].url;
                                xmlIconURL = xmlIconURL.toString().replace(/"/g, '');
                            } catch (err) {
                                adapter.log.debug(`Can not find a icon for ${strLocation}`);
                                xmlIconURL = "";
                            }

                            //Looking for the freiendlyName of a device
                            try {
                                xmlFriendlyName = path.friendlyName;
                                xmlFN = nameFilter(xmlFriendlyName.toString());
                            } catch (err) {
                                adapter.log.debug(`Can not read friendlyName of ${strLocation}`);
                                xmlFriendlyName = "Unknown";
                            }

                            //Looking for the manufacturerURL
                            try {
                                xmlManufacturerURL = path.manufacturerURL;
                                xmlManufacturerURL = xmlManufacturerURL.toString().replace(/"/g, '');
                            } catch (err) {
                                adapter.log.debug(`Can not read manufacturerURL of ${strLocation}`);
                                xmlManufacturerURL = '';
                            }

                            //Looking for the modelNumber
                            try {
                                xmlModelNumber = path.modelNumber;
                                xmlModelNumber = xmlModelNumber.toString().replace(/"/g, '');
                            } catch (err) {
                                adapter.log.debug(`Can not read modelNumber of ${strLocation}`);
                                xmlModelNumber = '';
                            }

                            //Looking for the modelDescription
                            try {
                                xmlModelDescription = path.modelDescription;
                                xmlModelDescription = xmlModelDescription.toString().replace(/"/g, '');
                            } catch (err) {
                                adapter.log.debug(`Can not read modelDescription of ${strLocation}`);
                                xmlModelDescription = '';
                            }

                            //Looking for the modelName
                            try {
                                xmlModelName = path.modelName;
                                xmlModelName = xmlModelName.toString().replace(/"/g, '');
                            } catch (err) {
                                adapter.log.debug(`Can not read modelName of ${strLocation}`);
                                xmlModelName = '';
                            }

                            //Looking for the modelURL
                            try {
                                xmlModelURL = path.modelURL;
                                xmlModelURL = xmlModelURL.toString().replace(/"/g, '');
                            } catch (err) {
                                adapter.log.debug(`Can not read modelURL of ${strLocation}`);
                                xmlModelURL = '';
                            }


                            //START - Creating the root object of a device
                            adapter.log.debug(`Creating root element for device: ${xmlFN}`);

                            adapter.setObjectNotExists(`${xmlFN}.${xmlTypeOfDevice}`, {
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
                                    modelURL: xmlModelURL
                                }
                            });
                            let pathRoot = result.root.device[0];
                            let objectName = `${xmlFN}.${xmlTypeOfDevice}`;
                            createServiceList(result, xmlFN, xmlTypeOfDevice, objectName, strLocation, strPort, pathRoot);
                            adapter.setObjectNotExists(`${xmlFN}.${xmlTypeOfDevice}.Alive`, {
                                type: 'state',
                                common: {
                                    name: 'Alive',
                                    type: 'boolean',
                                    role: 'indicator.state',
                                    read: true,
                                    write: true
                                },
                                native: {}
                            });
                            //END - Creating the root object of a device


                            //START - Creating SubDevices list for a device
                            let i_SubDevices = 0;
                            let xmlfriendlyName;

                            if (path.deviceList && path.deviceList[0].device) {
                                //Counting SubDevices
                                i_SubDevices = path.deviceList[0].device.length;

                                if (i_SubDevices) {
                                    //adapter.log.debug("Found more than one SubDevice");
                                    for (i = i_SubDevices - 1; i >= 0; i--) {

                                        //Looking for deviceType of device
                                        try {
                                            xmlDeviceType = path.deviceList[0].device[i].deviceType;
                                            xmlDeviceType = xmlDeviceType.toString().replace(/"/g, "");
                                            xmlTypeOfDevice = xmlDeviceType.toString().replace(/:\d/, "");
                                            xmlTypeOfDevice = xmlTypeOfDevice.replace(/.*:/, "");
                                            xmlTypeOfDevice = nameFilter(xmlTypeOfDevice);
                                            adapter.log.debug(`TypeOfDevice ${xmlTypeOfDevice}`);
                                        } catch (err) {
                                            adapter.log.debug(`Can not read deviceType of ${strLocation}`);
                                            xmlDeviceType = "";
                                        }

                                        //Looking for the freiendlyName of the SubDevice
                                        try {
                                            xmlfriendlyName = path.deviceList[0].device[i].friendlyName;
                                            xmlFN = nameFilter(xmlfriendlyName);
                                        } catch (err) {
                                            adapter.log.debug(`Can not read friendlyName of SubDevice from ${xmlFN}`);
                                            xmlfriendlyName = "Unknown";
                                        }
                                        //Looking for the manufacturer of a device
                                        try {
                                            xmlManufacturer = path.deviceList[0].device[i].manufacturer;
                                            xmlManufacturer = xmlManufacturer.toString().replace(/\"/g, "");
                                        } catch (err) {
                                            adapter.log.debug(`Can not read manufacturer of ${xmlfriendlyName}`);
                                            xmlManufacturer = "";
                                        }
                                        //Looking for the manufacturerURL
                                        try {
                                            xmlManufacturerURL = path.deviceList[0].device[i].manufacturerURL;
                                        } catch (err) {
                                            adapter.log.debug(`Can not read manufacturerURL of ${xmlfriendlyName}`);
                                            xmlManufacturerURL = "";
                                        }
                                        //Looking for the modelNumber
                                        try {
                                            xmlModelNumber = path.deviceList[0].device[i].modelNumber;
                                        } catch (err) {
                                            adapter.log.debug(`Can not read modelNumber of ${xmlfriendlyName}`);
                                            xmlModelNumber = "";
                                        }
                                        //Looking for the modelDescription
                                        try {
                                            xmlModelDescription = path.deviceList[0].device[i].modelDescription;
                                        } catch (err) {
                                            adapter.log.debug(`Can not read modelDescription of ${xmlfriendlyName}`);
                                            xmlModelDescription = "";
                                        }
                                        //Looking for deviceType of device
                                        try {
                                            xmlDeviceType = path.deviceList[0].device[i].deviceType;
                                        } catch (err) {
                                            adapter.log.debug(`Can not read DeviceType of ${xmlfriendlyName}`);
                                            xmlDeviceType = "";
                                        }
                                        //Looking for the modelName
                                        try {
                                            xmlModelName = path.deviceList[0].device[i].modelName;
                                        } catch (err) {
                                            adapter.log.debug(`Can not read modelName of ${xmlfriendlyName}`);
                                            xmlModelName = "";
                                        }
                                        //Looking for the modelURL
                                        try {
                                            xmlModelURL = path.deviceList[0].device[i].modelURL;
                                        } catch (err) {
                                            adapter.log.debug(`Can not read modelURL of ${xmlfriendlyName}`);
                                            xmlModelURL = "";
                                        }
                                        //Looking for UDN of a device
                                        try {
                                            xmlUDN = path.deviceList[0].device[i].UDN;
                                            xmlUDN = xmlUDN.toString().replace(/"/g, "");
                                            xmlUDN = xmlUDN.replace(/uuid:/g, "");
                                        } catch (err) {
                                            adapter.log.debug(`Can not read UDN of ${xmlfriendlyName}`);
                                            xmlUDN = "";
                                        }

                                        //The SubDevice object
                                        adapter.setObjectNotExists(`${xmlFN}.${xmlTypeOfDevice}`, {
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
                                                modelURL: xmlModelURL.toString()
                                            }
                                        }); //END SubDevice Object
                                        let pathSub = result.root.device[0].deviceList[0].device[i];
                                        let objectNameSub = `${xmlFN}.${xmlTypeOfDevice}`;
                                        createServiceList(result, xmlFN, xmlTypeOfDevice, objectNameSub, strLocation, strPort, pathSub);
                                        adapter.setObjectNotExists(`${xmlFN}.${xmlTypeOfDevice}.Alive`, {
                                            type: 'state',
                                            common: {
                                                name: 'Alive',
                                                type: 'boolean',
                                                role: 'indicator.state',
                                                read: true,
                                                write: true
                                            },
                                            native: {}
                                        });
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
                                                        xmlDeviceType = path.deviceList[0].device[i].deviceList[0].device[i2].deviceType;
                                                        xmlDeviceType = xmlDeviceType.toString().replace(/"/g, "");
                                                        xmlTypeOfDevice = xmlDeviceType.toString().replace(/:\d/, "");
                                                        xmlTypeOfDevice = xmlTypeOfDevice.replace(/.*:/, "");
                                                        xmlTypeOfDevice = nameFilter(xmlTypeOfDevice);
                                                        adapter.log.debug(`TypeOfDevice ${xmlTypeOfDevice}`);
                                                    } catch (err) {
                                                        adapter.log.debug(`Can not read deviceType of ${strLocation}`);
                                                        xmlDeviceType = "";
                                                    }

                                                    //Looking for the freiendlyName of the SubDevice
                                                    try {
                                                        xmlfriendlyName = path.deviceList[0].device[i].deviceList[0].device[i2].friendlyName;
                                                        xmlFN = nameFilter(xmlfriendlyName);
                                                    } catch (err) {
                                                        adapter.log.debug(`Can not read friendlyName of SubDevice from ${xmlFN}`);
                                                        xmlfriendlyName = "Unknown";
                                                    }
                                                    //Looking for the manufacturer of a device
                                                    try {
                                                        xmlManufacturer = path.deviceList[0].device[i].deviceList[0].device[i2].manufacturer;
                                                        xmlManufacturer = xmlManufacturer.toString().replace(/\"/g, "");
                                                    } catch (err) {
                                                        adapter.log.debug(`Can not read manufacturer of ${xmlfriendlyName}`);
                                                        xmlManufacturer = "";
                                                    }
                                                    //Looking for the manufacturerURL
                                                    try {
                                                        xmlManufacturerURL = path.deviceList[0].device[i].deviceList[0].device[i2].manufacturerURL;
                                                    } catch (err) {
                                                        adapter.log.debug(`Can not read manufacturerURL of ${xmlfriendlyName}`);
                                                        xmlManufacturerURL = "";
                                                    }
                                                    //Looking for the modelNumber
                                                    try {
                                                        xmlModelNumber = path.deviceList[0].device[i].deviceList[0].device[i2].modelNumber;
                                                    } catch (err) {
                                                        adapter.log.debug(`Can not read modelNumber of ${xmlfriendlyName}`);
                                                        xmlModelNumber = "";
                                                    }
                                                    //Looking for the modelDescription
                                                    try {
                                                        xmlModelDescription = path.deviceList[0].device[i].deviceList[0].device[i2].modelDescription;
                                                    } catch (err) {
                                                        adapter.log.debug(`Can not read modelDescription of ${xmlfriendlyName}`);
                                                        xmlModelDescription = "";
                                                    }
                                                    //Looking for deviceType of device
                                                    try {
                                                        xmlDeviceType = path.deviceList[0].device[i].deviceList[0].device[i2].deviceType;
                                                    } catch (err) {
                                                        adapter.log.debug("Can not read DeviceType of " + xmlfriendlyName);
                                                        xmlDeviceType = "";
                                                    }
                                                    //Looking for the modelName
                                                    try {
                                                        xmlModelName = path.deviceList[0].device[i].deviceList[0].device[i2].modelName;
                                                    } catch (err) {
                                                        adapter.log.debug(`Can not read DeviceType of ${xmlfriendlyName}`);
                                                        xmlModelName = "";
                                                    }
                                                    //Looking for the modelURL
                                                    try {
                                                        xmlModelURL = path.deviceList[0].device[i].deviceList[0].device[i2].modelURL;
                                                    } catch (err) {
                                                        adapter.log.debug(`Can not read modelURL of ${xmlfriendlyName}`);
                                                        xmlModelURL = "";
                                                    }
                                                    //Looking for UDN of a device
                                                    try {
                                                        xmlUDN = path.deviceList[0].device[i].deviceList[0].device[i2].UDN;
                                                        xmlUDN = xmlUDN.toString().replace(/"/g, "");
                                                        xmlUDN = xmlUDN.replace(/uuid:/g, "");
                                                    } catch (err) {
                                                        adapter.log.debug(`Can not read UDN of ${xmlfriendlyName}`);
                                                        xmlUDN = "";
                                                    }

                                                    //The SubDevice object
                                                    adapter.setObjectNotExists(`${xmlFN}.${TypeOfSubDevice}.${xmlTypeOfDevice}`, {
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
                                                            modelURL: xmlModelURL.toString()
                                                        }
                                                    }); //END SubDevice Object
                                                    pathSub = result.root.device[0].deviceList[0].device[i].deviceList[0].device[i2];
                                                    objectNameSub = `${xmlFN}.${TypeOfSubDevice}.${xmlTypeOfDevice}`;
                                                    createServiceList(result, xmlFN, `${TypeOfSubDevice}.${xmlTypeOfDevice}`, objectNameSub, strLocation, strPort, pathSub);
                                                    adapter.setObjectNotExists(`${xmlFN}.${TypeOfSubDevice}.${xmlTypeOfDevice}.Alive`, {
                                                        type: 'state',
                                                        common: {
                                                            name: 'Alive',
                                                            type: 'boolean',
                                                            role: 'indicator.state',
                                                            read: true,
                                                            write: true
                                                        },
                                                        native: {}
                                                    });
                                                } //END for
                                            }//END if
                                        } //END if
                                        //END - Creating SubDevices list for a sub-device

                                    } //END for
                                }//END if
                            } //END if
                            //END - Creating SubDevices list for a device

                        }//END else
                        })
            } catch (error) {
                adapter.log.debug(`Cannot parse answer from ${strLocation}: ${error}`);
            }
         }
        if(adapter.config.enableSimplePlayerControls) {
            setTimeout(function () {
                player.createPlayerStates();
            }, 5000)
        }
    });
    return true;
}
//END Reading the xml device description file of each upnp device

//START Creating serviceList
function createServiceList(result, xmlFN, xmlTypeOfDevice, object, strLocation, strPort, path){
    let i_services = 0;
    let i;
    let xmlService;
    let xmlServiceType;
    let xmlServiceID;
    let xmlControlURL;
    let xmlEventSubURL;
    let xmlSCPDURL;

    i_services = path.serviceList[0].service.length;

    //Counting services
    //adapter.log.debug("Number of services: " + i_services);

    for (i = i_services - 1; i >= 0; i--) {

        try {
            xmlService = path.serviceList[0].service[i].serviceType;
            xmlService = xmlService.toString().replace(/urn:.*:service:/g, "");
            xmlService = xmlService.replace(/:\d/g, "");
            xmlService = xmlService.replace(/\"/g, "");
        } catch(err){
            adapter.log.debug(`Can not read service of ${xmlFN}`);
            xmlService = "Unknown";
        }

        try {
            xmlServiceType = path.serviceList[0].service[i].serviceType;
        } catch(err){
            adapter.log.debug(`Can not read serviceType of ${xmlService}`);
            xmlServiceType = "";
        }

        try {
            xmlServiceID = path.serviceList[0].service[i].serviceId;
        } catch(err){
            adapter.log.debug(`Can not read serviceID of ${xmlService}`);
            xmlServiceID = "";
        }

        try {
            xmlControlURL = path.serviceList[0].service[i].controlURL;
        } catch(err){
            adapter.log.debug(`Can not read controlURL of ${xmlService}`);
            xmlControlURL = "";
        }

        try {
            xmlEventSubURL = path.serviceList[0].service[i].eventSubURL;
        } catch(err){
            adapter.log.debug(`Can not read eventSubURL of ${xmlService}`);
            xmlEventSubURL = "";
        }

        try {
            xmlSCPDURL = path.serviceList[0].service[i].SCPDURL;
            const patt = new RegExp(/(\/)/g);
            let test = patt.test(xmlSCPDURL);
            if(test === false){
                xmlSCPDURL = `/${xmlSCPDURL}`;
            }
        } catch(err){
            adapter.log.debug(`Can not read SCPDURL of ${xmlService}`);
            xmlSCPDURL = "";
        }

        adapter.setObjectNotExists(`${object}.${xmlService}`, {
            type: 'channel',
            common: {
                name: xmlService
            },
            native: {
                serviceType: xmlServiceType.toString(),
                serviceID:   xmlServiceID.toString(),
                controlURL:  xmlControlURL.toString(),
                eventSubURL: xmlEventSubURL.toString(),
                SCPDURL:     xmlSCPDURL.toString()
            }
        });

        adapter.setObjectNotExists(`${object}.${xmlService}.sid`, {
            type: 'state',
            common: {
                name: 'Subscription ID',
                type: 'string',
                role: 'indicator.state',
                read: true,
                write: true
            },
            native: {}
        });

        let SCPDlocation = `http://${strLocation}:${strPort}${xmlSCPDURL}`;
        let service = `${xmlFN}.${xmlTypeOfDevice}.${xmlService}`;
        readSCPD(SCPDlocation, service);

    }
}
//END Creating serviceList

//START Read the SCPD File  of a upnp device service
function readSCPD(SCPDlocation, service){

    adapter.log.debug("readSCPD for " + SCPDlocation);

    request(SCPDlocation, function (error, response, body) {
        if (!error && response.statusCode == 200) {

            try {
                parseString(body, {
                            explicitArray: true

                    },
                    function (err, result) {
                        adapter.log.debug("Parsing the SCPD XML file for " + SCPDlocation);

                        if (err) {
                            adapter.log.warn("Error: " + err);
                        } else {

                            if (!result || !result.scpd) {
                                adapter.log.debug('Error by parsing of ' + SCPDlocation);
                                return;
                            } //END if

                            createServiceStateTable(result, service);
                            createActionList(result, service);

                        } //END if
                    } //END function
                ); //END parseString
            } catch (error) {
                adapter.log.debug(`Cannot parse answer from ${SCPDlocation}: ${error}`);
            }
        }
        })
}
//END Read the SCPD File  of a upnp device service

//START Creating serviceStateTable
function createServiceStateTable(result, service){
    let i_stateVariable = 0;
    let i2 = 0;
    let i_allowedValue = 0;
    let path;
    let stateVariableAttr;
    let xmlName;
    let xmlDataType;
    let xmlAllowedValue;
    let strAllowedValues;
    let strDefaultValue;
    let strMinimum;
    let strMaximum;
    let strStep;

        try{path = result.scpd.serviceStateTable[0];} catch (err) {path = result.scpd.serviceStateTable};
         try{i_stateVariable = path.stateVariable.length;} catch(err){i_stateVariable = 1;};

        //Counting stateVariable's
        //adapter.log.debug("Number of stateVariables: " + i_stateVariable);
            try {
                for (i2 = i_stateVariable - 1; i2 >= 0; i2--) {
                    stateVariableAttr = undefined;
                    strAllowedValues = "";
                    strMinimum = undefined;
                    strMaximum = undefined;
                    strStep = undefined;

                    stateVariableAttr = path.stateVariable[i2]['$'].sendEvents;
                    xmlName = path.stateVariable[i2].name;
                    xmlDataType = path.stateVariable[i2].dataType;


                    try {

                        for (xmlAllowedValue in path.stateVariable[i2].allowedValueList[0].allowedValue) {
                            let numberOfValue = xmlAllowedValue;
                            xmlAllowedValue = path.stateVariable[i2].allowedValueList[0].allowedValue[numberOfValue];
                            strAllowedValues = `${strAllowedValues}${xmlAllowedValue} `;
                        }
                    } catch (err) {
                    }

                    try {
                        xmlAllowedValue = path.stateVariable[i2].defaultValue;
                        strDefaultValue = xmlAllowedValue.replace(/\"/g, "");
                    } catch (err) {
                    }

                    try {
                        strMinimum = path.stateVariable[i2].allowedValueRange[0].minimum;
                        try {
                            strMinimum = strMinimum.toString();
                        } catch (err) {
                        }
                    } catch (err) {
                    }

                    try {
                        strMaximum = path.stateVariable[i2].allowedValueRange[0].maximum;
                        try {
                            strMaximum = strMaximum.toString();
                        } catch (err) {
                        }
                    } catch (err) {
                    }
                    try {
                        strStep = path.stateVariable[i2].allowedValueRange[0].step;
                        try {
                            strStep = strStep.toString();
                        } catch (err) {
                        }
                    } catch (err) {
                    }


                    createService();
                }//END for
            } catch(err){}

    function createService() {
        //Handles DataType ui2 as Number
        let dataType;
        if(xmlDataType.toString() === 'ui2'){
            dataType = 'number';
        } else {
            dataType = xmlDataType.toString();
        }
        adapter.setObjectNotExists(`${service}.${xmlName}`, {
            type: 'state',
            common: {
                name: xmlName.toString(),
                type: dataType,
                role: "indicator.state",
                read: true
            },
            native: {
                    sendEvents: stateVariableAttr,
                    allowedValues: strAllowedValues,
                    defaultValue: strDefaultValue,
                    minimum: strMinimum,
                    maximum: strMaximum,
                    step: strStep,
            }
        });

    }
    //END Add serviceList for SubDevice

} //END function
//END Creating serviceStateTable



//START Creating actionList
function createActionList(result, service){
    let i_action = 0;
    let i2;
    let path;
    let xmlName;

    path = result.scpd.actionList[0];
    try{i_action = path.action.length;} catch (err) {i_action = 1;}

    //Counting action's
    //adapter.log.debug("Number of actions: " + i_action);

    if (i_action) {
        try {
            for (i2 = i_action - 1; i2 >= 0; i2--) {

                xmlName = path.action[i2].name;

                createAction();
            }
        }catch (err) {}

    }//END if

    function createAction(){
        adapter.setObjectNotExists(`${service}.${xmlName}`, {
            type: 'state',
            common: {
                name: xmlName.toString(),
                role: 'action',
                type: 'mixed',
                read: true,
                write: true
            },
            native: {}
        });

        try {
            createArgumentList(result, service, xmlName, i2, path);
        } catch(err){
            adapter.log.debug(`There is no argument for ${xmlName}`);
        }
    }
    //END Add serviceList for SubDevice

} //END function
//END Creating actionList



//START Creating argumentList
function createArgumentList(result, service, actionName, action_number, path){
    let i_argument = 0;
    let i2;
    let xmlName;
    let xmlDirection;
    let xmlrelStateVar;

    //adapter.log.debug("Reading argumentList for " + actionName);

    try{i_argument = path.action[action_number].argumentList[0].argument.length;} catch (err){i_argument = 1;}

    //Counting arguments's
    //adapter.log.debug("Number of argument's: " + i_argument);

    if (i_argument) {

        for (i2 = i_argument - 1; i2 >= 0; i2--) {

            try {
                xmlName = path.action[action_number].argumentList[0].argument[i2].name;
            } catch(err){
                adapter.log.debug(`Can not read argument Name of ${actionName}`);
                xmlName = "Unknown";
            }

            try {
                xmlDirection = path.action[action_number].argumentList[0].argument[i2].direction;
            } catch(err) {
                adapter.log.debug(`Can not read direction of ${actionName}`);
                xmlDirection = "";
            }

            try {
                xmlrelStateVar = path.action[action_number].argumentList[0].argument[i2].relatedStateVariable;
            } catch(err) {
                aadapter.log.debug(`Can not read relatedStateVariable of ${actionName}`);
                xmlrelStateVar = "";
            }
            createArgument(i2);
        }
    }//END if

    function createArgument(arg_no){
        adapter.setObjectNotExists(`${service}.${actionName}.${xmlName}`, {
            type: 'state',
            common: {
                name: xmlName.toString,
                role: 'argument',
                type: 'mixed',
                read: true,
                write: true
            },
            native: {direction: xmlDirection.toString(),
                relatedStateVariable: xmlrelStateVar.toString(),
                Argument_No: arg_no +1}
        }); //END adapter.setObject()
    }
    //END Add argumentList for action

} //END function
//END Creating argumentList


//START Server for Alive and ByeBye messages
let own_uuid = 'uuid:f40c2981-7329-40b7-8b04-27f187aecfb5'; //this string is for filter message's from upnp Adapter
let Server = require('node-ssdp').Server
    , server = new Server({
    ssdpIp: '239.255.255.250',
});
//helper variables for start adding new devices
let devices;
let is_running;

//Identification of upnp Adapter/ioBroker as upnp Service and it's capabilities
//at this time there is no implementation of upnp service capabilities, it is only necessary for the server to run
server.addUSN('upnp:rootdevice');
server.addUSN('urn:schemas-upnp-org:device:IoTManagementandControlDevice:1');

server.on('advertise-alive', function (headers) {
    let usn;
    try {
        usn = JSON.stringify(headers['USN']);
        usn = usn.toString();
        usn = usn.replace(/uuid:/ig, "");
        usn = usn.replace(/::.*/ig, '"');
    }catch(err){
        adapter.log.error(err);
        usn = ' ';
    }
    let nt = JSON.stringify(headers['NT']);
    let location = JSON.stringify(headers['LOCATION']);
    if(usn.match(/.*f40c2981-7329-40b7-8b04-27f187aecfb5.*/)) {
    } else {

        adapter.getDevices(function (err, devices) {
            let device;
            let device_id;
            let device_uuid;
            let device_usn;
            let found_uuid = false;
            for(device in devices){
                device_uuid = JSON.stringify(devices[device]['native']['uuid']);
                device_usn = JSON.stringify(devices[device]['native']['deviceType']);
                //Set object Alive for the Service true
                if(device_uuid == usn && device_usn == nt){
                    let max_age = JSON.stringify(headers['CACHE-CONTROL']);
                    try{max_age = max_age.replace(/max-age.=./ig, '');} catch(err){};
                    try{max_age = max_age.replace(/max-age=/ig, '');} catch(err){};
                    try{max_age = max_age.replace(/\"/ig, '');} catch(err){};
                    device_id = JSON.stringify(devices[device]['_id']);
                    device_id = device_id.replace(/\"/ig, '');
                    adapter.setState(`${device_id}.Alive`, {val: true, ack: true, expire: max_age});
                } //END if
                if(device_uuid == usn){
                    found_uuid = true;
                } //END if
            } //END for
            if(found_uuid != true && adapter.config.enableAutoDiscover === true) {
                adapter.log.info(`Found new device: ${location}`);
                if (is_running) {
                } else {
                    is_running = true;
                    catch_new_devices(location);
                    } //END if
                } //END if

        }); //END adapter.getDevices()
    } //END if
});
// /END server.on('advertise-alive')

server.on('advertise-bye', function (headers) {
    let usn = JSON.stringify(headers['USN']);
    usn = usn.toString();
    usn = usn.replace(/uuid:/g, '');
    try{usn.replace(/::.*/ig, '')} catch(err) {};
    let nt = JSON.stringify(headers['NT']);
    let location = JSON.stringify(headers['LOCATION']);
    if(usn.match(/.*f40c2981-7329-40b7-8b04-27f187aecfb5.*/)) {
    } else {
        adapter.getDevices(function (err, devices) {
            let device;
            let device_id;
            let device_uuid;
            let device_usn;
            for(device in devices){
                device_uuid = JSON.stringify(devices[device]['native']['uuid']);
                device_usn = JSON.stringify(devices[device]['native']['deviceType']);
                //Set object Alive for the Service false
                if(device_uuid == usn){
                    device_id = JSON.stringify(devices[device]['_id']);
                    device_id = device_id.replace(/\"/ig, '');
                    adapter.setState(`${device_id}.Alive`, {val: false, ack: true});
                } //END if
            }  //END for
        }); //END adapter.getDevices()
    } //END if
});
//END server.on('advertise-bye')


//start the server
setTimeout(function(){
    server.start();
}, 15000);

//is called if device isn't already in objects present
function catch_new_devices(device){
    device = device.replace(/\"/ig, '')
    firstDevLookup(device);
    is_running = false;
}

function stop_server() {
    server.stop(); // advertise shutting down and stop listening
}
//END Server for Alive and ByeBye messages


//START Event listener
let service;
let device_ip;
let device_port;
let infoSub;
let answer;

//Subscribe to every service that is alive. Triggered by change alive from false/null to true.
function subscribe_event(id, state){
    service = id.replace(/\.Alive/ig, '');
    let alive = JSON.stringify(state['val']);
    if(alive == 'true' && adapter.config.enableAutoSubscription === true) {
        adapter.getObject(service, function (err, obj) {
            device_ip = JSON.stringify(obj.native.ip);
            device_ip = device_ip.replace(/\"/ig, '');
            device_port = JSON.stringify(obj.native.port);
            device_port = device_port.replace(/\"/ig, '');

            adapter.getChannelsOf(obj.common.name, function (err, _channel) {
                    for (let x = _channel.length - 1; x >= 0; x--) {

                            let event_url;
                            try {
                                event_url = JSON.stringify(_channel[x].native.eventSubURL);
                            } catch (err) {
                            }
                            try {
                                event_url = event_url.replace(/\"/ig, '');
                            } catch (err) {
                            }
                            try {
                                    infoSub = new Subscription(device_ip, device_port, event_url, 1000);
                                    listener(event_url, _channel[x]);
                            } catch (err){}


                    } //END for
            }); //END adapter.getChannelsOf()
        }); //END adapter.getObjects()
    } //END if
} //END function subscribe_event


//START message handler for subscriptions
function listener(event_url, _channel) {
    let variabaleTimeout;

    if (infoSub) {
        infoSub.on('subscribed', function (sid) {
            variabaleTimeout = +5;
            setTimeout(function(){adapter.setState(_channel._id + '.sid', {val: sid.sid, ack: true})}, variabaleTimeout);
            setTimeout(function(){variabaleTimeout = 0}, 100)
        });

        infoSub.on('message', function (obj) {
            variabaleTimeout = +5;
            setTimeout(function(){
                events2objects(obj, _channel);
            }, variabaleTimeout);
            setTimeout(function(){variabaleTimeout = 0}, 100)
        });
        infoSub.on('error', function (obj) {
            adapter.log.debug(`Subscription error: ` + JSON.stringify(obj));
            //subscription.unsubscribe();
        });

        infoSub.on('resubscribed', function (sid) {
            //adapter.log.info('SID: ' + JSON.stringify(sid) + ' ' + event_url + ' ' + _channel['_id']);
            variabaleTimeout = +5;
            setTimeout(function(){adapter.setState(`${_channel['_id']}.sid`, {val: sid.sid, ack: true})}, variabaleTimeout);
            setTimeout(function(){variabaleTimeout = 0}, 100)
        });
    } //END if
} //END function listener()


let arrSID = [];
let state;


//Get all .sid Objects for the services and build an array, that is used as index to find them faster
function events2objects(data, _channel){
    let lookup;
    let arrLength = arrSID.length;
    if(arrLength == 0){
        arrSID.push('dummy');
        //Fill array arrSID if it is empty
        adapter.getStatesOf(`upnp.${adapter.instance}`, function (err, _states) {
        let statesLength = _states.length;

        for (let x = statesLength - 1; x >= 0; x--) {
            if (JSON.stringify(_states[x]['_id']).match(/\.sid/g) == null) {
                //if the match deliver null nothing is to do
            } else {
                //if the match deliver an id of an object add them to the array
                arrSID.push(_states[x]['_id']);
            }
        } //END for
    }); //END adapter.getStatesOf()

            //adapter.log.debug('Array arrSID is now filled');
            //When the array is filled start the search
            lookup = new lookup_service(data, arrLength);


    }else {
        //Start Search
        if (arrLength == 1) {
            //adapter.log.debug('Waiting for the array');
            setTimeout(function () {
                //adapter.log.debug('50ms gone ' + arrSID.length);
                lookup = new lookup_service(data, arrLength);
            }, 1500)
        } else {
            //adapter.log.debug('Array arrSID is already filled');
            lookup = new lookup_service(data, arrLength);
        }

    } //END if

    let sid = JSON.stringify(data['sid']);
} //END function events2object


function lookup_service(data, arrLength){
    let counter = 0;
    counter = arrLength;
    for(let y = arrLength -1; y >= 0; y--){
        //Get a state from the list in arrSID
        adapter.getState(arrSID[y], function(err, obj){
            if(err != null){
                adapter.log.error(`Error in lookup_service: ${err}`);
            }else{
                counter = counter - 1;
                let sNS = new setNewState(obj, counter, data)
            }
        });
    }//END for
}

function setNewState(obj, count, data){
    let varsid;
    try{varsid = obj['val'];} catch(err){} //Extract the value of the state

    if(varsid != null){
        let helper = JSON.stringify(data['sid']); //Get the sid from actual message
        let helper2 = helper.replace(/\"/ig, "");
        let searchString = new RegExp(helper2, 'ig'); //Create a regular expression with the sid of actual message
        let found = varsid.match(searchString);

        if(found != null) {
            let serviceID = arrSID[count];
            serviceID = serviceID.replace(/\.sid/ig, '');

            //Select sub element with States
            let newStates;
                newStates = data['body']['e:propertyset']['e:property'];

            try{
                newStates = newStates['LastChange']['_'];
            } catch (err) {}

            if(newStates == undefined){
                newStates = data['body']['e:propertyset']['e:property']['LastChange'];
            }

            let newStates2 = JSON.stringify(newStates);

            if(newStates2.match(/<Event.*/ig) != null){
                parseString(newStates, function(err, result) {
                    let states = new convertEventObject(result['Event']);
                    //split everey array meber into state name and value, then push it to iobroker state
                    let state_name;
                    let val;

                    for(let x = states.length -1; x >= 0; x--){
                        let strState = states[x].toString();
                        state_name = strState.match(/\"\w*/i);
                        state_name = state_name.toString();
                        state_name = state_name.replace(/\"/i, "");

                        //looking for the value
                        val = strState.match(/val\":\"(\w*(:\w*|,\s\w*)*)/ig);
                        if(val != null) {
                            val = val.toString();
                            val = val.replace(/val\":\"/ig, "");
                        }

                        valChannel(strState, serviceID);
                        let xSet = new writeState(serviceID, state_name, val);


                    }
                }); //END parseString()
            }else if(newStates2.match(/"\$":/ig) != null){
                let states = new convertWM(newStates);

                //split everey array meber into state name and value, then push it to iobroker state
                let state_name;
                let val;

                for(let z = states.length -1; z >= 0; z--){
                    let strState = states[z].toString();
                    state_name = strState.match(/\"\w*/i);
                    state_name = state_name.toString();
                    state_name = state_name.replace(/\"/i, "");

                    val = valLookup(strState);

                    valChannel(strState, serviceID);
                    let xSet = new writeState(serviceID, state_name, val);

                }
            }else{
                //Read all other messages and write the states to the related objects
                let states = new convertInitialObject(newStates);

                //split everey array meber into state name and value, then push it to iobroker state
                let state_name;
                let val;

                let InstanceID;
                for(let z = states.length -1; z >= 0; z--){
                    let strState = states[z].toString();
                    state_name = strState.match(/\"\w*/i);
                    state_name = state_name.toString();
                    state_name = state_name.replace(/\"/i, "");

                    val = valLookup(strState);

                    valChannel(strState, serviceID);
                    let xSet = new writeState(serviceID, state_name, val);

                }
            } //END if Event

        } //END if
    } //END if
}

//write state
function writeState(sID, sname, val){
    adapter.getObject(`${sID}.${sname}`, function (err,obj){
        if(obj == null){
            adapter.setState(`${sID}.A_ARG_TYPE_${sname}`, {val: val, ack: true});
        }
    });

    adapter.getObject(`${sID}.${sname}`, function (err,obj) {
        if(obj != null) {
            adapter.setState(`${sID}.${sname}`, {val: val, ack: true});
        }
    });
}

//looking for the value of channel
function valChannel(strState, serviceID){
    //looking for the value of channel
    let channel = strState.match(/channel\":\"(\w*(:\w*|,\s\w*)*)/ig);
    if(channel != null) {
        channel = channel.toString();
        channel = channel.replace(/channel\":\"/ig, "");
        adapter.setState(`${serviceID}.A_ARG_TYPE_Channel`, {val: channel, ack: true})
    }
}

//looking for the value
function valLookup(strState){
   let val = strState.match(/\w*\":\"(\w*\D\w|\w*|,\s\w*|(\w*:)*(\*)*(\/)*(,)*(\-)*(\.)*)*/ig);
    if(val != null) {
        val = val.toString();
        val = val.replace(/\"\w*\":\"/i, "");
        val = val.replace(/\"/ig, "");
        val = val.replace(/\w*:/, "")
    }
    return val;
}

//Not used now
function convertEvent(data){
        let change = data.replace(/<\\.*>/ig, '{"');
        change = data.replace(/</ig, '{"');
        change = change.replace(/\s/ig, '""');
        change = change.replace(/=/ig, ':');
        change = change.replace(/\\/ig, '');
        change = change.replace(/>/ig, '}');
}

//convert the event JSON into an array
function convertEventObject(result) {
    const regex = new RegExp(/\"\w*\":\[{\"\$\":{(\"\w*\":\"(\w*:\w*:\w*|(\w*,\s\w*)*|\w*)\"(,\"\w*\":\"\w*\")*)}/ig);
    let strResult = JSON.stringify(result);
    let matches = strResult.match(regex);
    return matches;
}

//convert the initial message JSON into an array
function convertInitialObject(result){
    const regex = new RegExp(/"\w*":"(\w*|\w*\D\w*|(\w*-)*\w*:\w*|(\w*,\w*)*|\w*:\S*\*)"/g);
    let strResult = JSON.stringify(result);
    let matches = strResult.match(regex);
    return matches;
}

//convert the initial message JSON into an array for windows media player/server
function convertWM(result){
    const regex = new RegExp(/"\w*":\{".":"(\w*"|((http-get:\*:\w*\/((\w*\.)*|(\w*-)*|(\w*\.)*(\w*-)*)\w*:\w*\.\w*=\w*(,)*)*((http-get|rtsp-rtp-udp):\*:\w*\/(\w*(\.|-))*\w*:\*(,)*)*))/g);
    let strResult = JSON.stringify(result);
    let matches = strResult.match(regex);
    return matches;
}

//END Event listener


const upnp_instance = `upnp.${adapter.instance}`;

//START clear Alive and sid's states when Adapter stops
function clearAsStates(){
    //Clear sid
    let arrLength = arrSID.length;
    if(arrLength != 0){
        for(let x = arrLength; x >= 0; x--){
            try{adapter.setState(arrSID[x], {val: '', ack: true})
            } catch(err) {}
        } //END for
    } //END if

    //Clear Alive
    arrLength = arrAlive.length;
    if(arrLength != 0){
        for(let y = arrLength; y >= 0; y--){
            try{adapter.setState(arrAlive[y], {val: 'false', ack: true})
            } catch(err) {}
        } //END for
    } //END if

    adapter.log.info('Alive and sid states cleared');
}
//END clear Alive and sid's

function createAliveArr(){
    adapter.getStatesOf(`upnp.${adapter.instance}`, function(err, _states){
        let arrLength = arrAlive.length;
        let statesLength = _states.length;
        if(arrLength == 0) {

            for (let x = statesLength - 1; x >= 0; x--) {
                if (JSON.stringify(_states[x]['_id']).match(/\.Alive/g) == null) {
                    //if the match deliver null nothing is to do
                } else {
                    arrAlive.push(_states[x]['_id']);
                }
            } //END for
        } //END if
    }); //END adapter.getStatesOf()
}


//START control of devices
let test = [];

function sendCommand(obj){
        adapter.log.debug('Send Command');
    let id = obj._id;
    let actionName = obj.common.name;
    let service = id.replace(`.${actionName}`, '');

    adapter.getObject(service, function (err, obj){
        let vServiceType = obj.native.serviceType;
        let serviceName = obj.common.name;
        let device = service.replace(`.${serviceName}`, '');
        let vControlURL = obj.native.controlURL;
        adapter.getObject(device, function (err, obj){

            let ip = obj.native.ip;
            let port = obj.native.port;
            let cName = JSON.stringify(obj._id);
            cName = cName.replace(/\.\w*"$/g, '');
            cName = cName.replace(/^"/g, '');
            adapter.getStatesOf(cName, function(err, _states){

                let args = [];

                for(let x = _states.length -1; x >= 0; x--){
                    let argumentsOfAction = _states[x]._id;
                    let obj = _states[x];
                    let test2 = id + '\\.';
                    try{test2 = test2.replace(/\(/gi, '.');} catch(err){adapter.log.debug(err)}
                    try{test2 = test2.replace(/\)/gi, '.');} catch(err){adapter.log.debug(err)}
                    try{test2 = test2.replace(/\[/gi, '.');} catch(err){adapter.log.debug(err)}
                    try{test2 = test2.replace(/\]/gi, '.');} catch(err){adapter.log.debug(err)}
                    let re = new RegExp(test2, 'g');
                    let testResult = re.test(argumentsOfAction);
                    if(testResult == true && argumentsOfAction != id){
                        args.push(obj);
                    }

                } //END for



                let body = '';

                //get all states of the arguments as string
                adapter.getStates(`${id}.*`,function (err, idStates){
                    let helperBody = [];
                    let states = JSON.stringify(idStates);
                    states = states.replace(/,"ack":\w*,"ts":\d*,"q":\d*,"from":"(\w*\.)*(\d*)","lc":\d*/g, '');

                    for(let z = args.length -1; z >= 0; z--){
                        //check if the argument has to be send with the action
                        if (args[z].native.direction == 'in') {
                            let arg_no = args[z].native.Argument_No;

                            //check if the argument is already written to the helperBody array, if not found value and add to array
                            if(helperBody[arg_no] == null) {

                                let test2 = args[z]._id;
                                //replace signs that could cause problems with regex
                                try {
                                    test2 = test2.replace(/\(/gi, '.');
                                } catch (err) {
                                }
                                try {
                                    test2 = test2.replace(/\)/gi, '.');
                                } catch (err) {
                                }
                                try {
                                    test2 = test2.replace(/\[/gi, '.');
                                } catch (err) {
                                }
                                try {
                                    test2 = test2.replace(/\]/gi, '.');
                                } catch (err) {
                                }

                                let test3 = test2 + '":{"val":("[^"]*|\\d*)}?'
                                let patt = new RegExp(test3, 'g');

                                let testResult2;

                                let testResult = states.match(patt);
                                testResult2 = JSON.stringify(testResult);
                                testResult2 = testResult2.match(/val\\":(\\"[^"]*|\d*)}?/g)
                                testResult2 = JSON.stringify(testResult2);
                                testResult2 = testResult2.replace(/\["val(\\)*":(\\)*/, '');
                                try{testResult2 = testResult2.replace(/\]/, '');} catch (err){};
                                try{testResult2 = testResult2.replace(/}\"/, '');} catch (err){};
                                    try {
                                        testResult2 = testResult2.replace(/\"/g, '');
                                    } catch (err) {
                                    }


                                //extract argument name from id string
                                let test1 = args[z]._id;
                                let argName = test1.replace(`${id}\.`, '');

                                helperBody[arg_no] = "<" + argName + ">" + testResult2 + "</" + argName + ">";
                            }
                        }
                    } //END for

                    //convert helperBody array to string and add it to main body string
                    helperBody = helperBody.toString();
                    try{helperBody = helperBody.replace(/,/g, '');} catch(err){}
                    body += helperBody;
                    body = "<u:" + actionName + " xmlns:u=\"" + vServiceType + "\">" + body;
                    body += "</u:" + actionName + ">";

                    createMessage(vServiceType, actionName, ip, port, vControlURL, body, id);
                });

            })
        }); //END getObject()
    }); //END getObject()
} //END sendCommand()

//START creat Action message
function createMessage(sType, aName, _ip, _port, cURL, body, action_id){
    const UA = "UPnP/1.0, ioBroker.upnp";
    let url = `http://${_ip}:${_port}${cURL}`;

    const contentType = "text/xml; charset=\"utf-8\"";
    let soapAction = `${sType}#${aName}`;
    let postData=
        `<s:Envelope s:encodingStyle=\"http://schemas.xmlsoap.org/soap/encoding/\" xmlns:s=\"http://schemas.xmlsoap.org/soap/envelope/\">
        <s:Body>${body}</s:Body>
        </s:Envelope>`;

    //Options for the SOAP message
    let options = {
        uri: url,
        headers: {
            'Content-Type': contentType,
            'SOAPAction': '"' + soapAction + '"',
            'USER-AGENT': UA
        },
        method: 'POST',
        body: postData
    };

    //Send Action message to Device/Service
    request(options, function(err, res, body) {
        adapter.log.debug('response');
        if(err != null){
            adapter.log.warn(`Error sending SOAP request: ${err}`);
        } else {
            if (res['statusCode'] != '200') {
                adapter.log.warn(`Unexpected answer from upnp service: ` + JSON.stringify(res) + `\n Sent message: ` + JSON.stringify(options));
            } else {
                //look for data in the response
                const pattData = new RegExp(/<[^\/]\w*\s*[^<]*/g); //second attempt
                //die Zusätlichen infos beim Argument namen müssen entfernt werden damit er genutzt werden kann
                let foundData = body.match(pattData);
                if (foundData != null) {

                    for (let i = foundData.length - 1; i >= 0; i--) {
                        let foundArgName = foundData[i].match(/<\w*>/);
                        let strFoundArgName;
                        let argValue;
                        if (foundArgName != null) {
                            strFoundArgName = JSON.stringify(foundArgName);
                            strFoundArgName = strFoundArgName.replace(/\"/g, '');
                            strFoundArgName = strFoundArgName.replace(/\[/g, '');
                            strFoundArgName = strFoundArgName.replace(/\]/g, '');
                            argValue = foundData[i].replace(strFoundArgName, '');
                            strFoundArgName = strFoundArgName.replace('<', '');
                            strFoundArgName = strFoundArgName.replace('>', '');
                        } else {
                            foundArgName = foundData[i].match(/<\w*\s/);
                            strFoundArgName = JSON.stringify(foundArgName);
                            strFoundArgName = strFoundArgName.replace(/\"/g, '');
                            strFoundArgName = strFoundArgName.replace(/\[/g, '');
                            strFoundArgName = strFoundArgName.replace(/\]/g, '');
                            strFoundArgName = strFoundArgName.replace('<', '');
                            strFoundArgName = strFoundArgName.replace(/\s$/, '');
                            argValue = foundData[i].replace(/<.*>/, '');
                        }

                        if (strFoundArgName != 'null') {
                            let argID = action_id + '.' + strFoundArgName;
                            adapter.setState(argID, {val: argValue, ack: true});
                            //look for relatedStateVariable and setState
                            let syncArg = new syncArgument(action_id, argID, argValue);
                        }

                    }

                } else {
                    adapter.log.debug('Nothing found: ' + JSON.stringify(body));
                }

            }//END if
        }//END if error

    });

}
//END creat Action message

//Sync Argument with relatedStateVariable
function syncArgument(action_id, argID, argValue){
    try {
        adapter.getObject(argID, function (err, obj) {
            if(obj !== undefined && obj !== null && obj !== ''){
                let relatedStateVariable = obj.native.relatedStateVariable;
                let serviceID = action_id.replace(/\.\w*$/, '');
                let relStateVarID = serviceID + '.' + relatedStateVariable;
                adapter.setState(relStateVarID, {val: argValue, ack: true})
            }
        })
    }catch(err){}
}

function nameFilter(name){
    let signs = [String.fromCharCode(46), String.fromCharCode(44), String.fromCharCode(92), String.fromCharCode(47), String.fromCharCode(91), String.fromCharCode(93),
        String.fromCharCode(123), String.fromCharCode(125), String.fromCharCode(32), String.fromCharCode(129), String.fromCharCode(154), String.fromCharCode(132),
        String.fromCharCode(142), String.fromCharCode(148), String.fromCharCode(153), String.fromCharCode(42), String.fromCharCode(63), String.fromCharCode(34), String.fromCharCode(39),
        String.fromCharCode(96)];
    //46=. 44=, 92=\ 47=/ 91=[ 93=] 123={ 125=} 32=Space 129=ü 154=Ü 132=ä 142=Ä 148=ö 153=Ö 42=* 63=? 34=" 39=' 96=`

    signs.forEach(function(item, index){
        let count = name.split(item).length - 1;

        for(let i = 0; i < count; i++) {
            name = name.replace(item, '_');
        }

        let result = name.search (/_$/);
        if(result != -1){
            name = name.replace(/_$/, '');
        }
    });
    return name;
}
