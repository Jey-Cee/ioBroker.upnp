/**
 *
 * template adapter
 *
 *
 *  file io-package.json comments:
 *
 *  {
 *      "common": {
 *          "name":         "upnp",                  					// name has to be set and has to be equal to adapters folder name and main file name excluding extension
 *          "version":      "0.2.2",                    						// use "Semantic Versioning"! see http://semver.org/
 *          "title":        "upnp Adapter",  							// Adapter title shown in User Interfaces
 *          "authors":  [                               						// Array of authord
 *              "Jey Cee <jey-cee@live.com>"
 *          ]
 *          "desc":         "Discovers upnp clients on the Network",          	// Adapter description shown in User Interfaces. Can be a language object {de:"...",ru:"..."} or a string
 *          "platform":     "Javascript/Node.js",       						// possible values "javascript", "javascript/Node.js" - more coming
 *          "mode":         "daemon",                   						// possible values "daemon", "schedule", "subscribe"
 *          "schedule":     "0 0 * * *"                 						// cron-style schedule. Only needed if mode=schedule
 *          "loglevel":     "info"                      						// Adapters Log Level
 *      },
 *      "native": {                                     						// the native object is available via adapter.config in your adapters code - use it for configuration
 *          "test1": true,
 *          "test2": 42
 *      }
 *  }
 *
 */

/* jshint -W097 */// jshint strict:false
/*jslint node: true */
"use strict";

// you have to require the utils module and call adapter function
var utils = require(__dirname + '/lib/utils'); // Get common adapter utils

//include node-ssdp and node-upnp-subscription
var Client = require('node-ssdp').Client;
var client = new Client();
var Subscription = require('node-upnp-subscription');


// you have to call the adapter function and pass a options object
// name has to be set and has to be equal to adapters folder name and main file name excluding extension
// adapter will be restarted automatically every time as the configuration changed, e.g system.adapter.template.0
var adapter = utils.adapter('upnp');

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
    adapter.log.info('objectChange ' + id + ' ' + JSON.stringify(obj));
});

// is called if a subscribed state changes
adapter.on('stateChange', function (id, state) {
    // Warning, state can be null if it was deleted
    //adapter.log.info('stateChange ' + id + ' ' + JSON.stringify(state));
    var lastChange;
    adapter.getState(id, function(err, obj){
        try{lastChange = obj['lc'];} catch(err){}
        var d = new Date();
        var timeNow = d.getTime();
        var diff = timeNow - lastChange;
        if(diff <= 10) {
            //adapter.log.debug('Letzte Änderung: ' + lastChange + ' ' + timeNow + ' ' + diff);
            subscribe_event(id, state)
        }
    });

    if(id.match(/\.Alive/ig)){
        //subscribe_event(id, state)
    }
    // you can use the ack flag to detect if it is status (true) or command (false)
    if (state && !state.ack) {
        //adapter.log.info('ack is not set!');
    }
});


// is called when databases are connected and adapter received configuration.
// start here!
adapter.on('ready', main);



var foundIPs = []; // Array for the caught broadcast answers
var parseString = require('xml2js').parseString;
var request     = require('request');
var arrAlive = [];

function main() {
    adapter.subscribeStates('*');
    sendBroadcastToAll();

    //Filtering the Device description file addresses, timeout is necessary to wait for all answers
    setTimeout(function () {
        adapter.log.debug("Found " + foundIPs.length + " devices");
    }, 5000);

    createAliveArr();
}

function sendBroadcastToAll() {
    adapter.log.debug("Send Broadcast");

    //Sends a Broadcast and catch the URL with xml device description file
    client.on('response', function (headers, statusCode, rinfo) {
        var strHeaders = JSON.stringify(headers, null, ' ');
        var jsonAnswer = JSON.parse(strHeaders);
        var answer = jsonAnswer.LOCATION;

        if (foundIPs.indexOf(answer) === -1) {
            foundIPs.push(answer);


            if(answer != answer.match(/.*dummy.xml/g)) {
                setTimeout(function () {
                    firstDevLookup(answer);
                }, 1000);
            };
        }
    });

    client.search('ssdp:all');

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
                        mergeAttrs:    true
                    },
                    function (err, result) {
                        var path;
                        var xmlDeviceType;
                        var xmlTypeOfDevice;
                        var xmlUDN;
                        var xmlManufacturer;

                        adapter.log.debug("Parsing the XML file for " + strLocation);

                        if (err) {
                            adapter.log.warn("Error: " + err);
                        } else {
                            adapter.log.debug("Creating objects for " + strLocation);
                            var i;

                            if (!result || !result.root || !result.root.device) {
                                adapter.log.warn('Error by parsing of ' + strLocation + ': Cannot find deviceType');
                                return;
                            }

                            path = result.root.device[0];
                            //Looking for deviceType of device
                            try {
                                xmlDeviceType = path.deviceType;
                                xmlDeviceType = xmlDeviceType.toString().replace(/"/g, "");
                                xmlTypeOfDevice = xmlDeviceType.toString().replace(/:\d/, "");
                                xmlTypeOfDevice = xmlTypeOfDevice.replace(/.*:/, "");
                                adapter.log.debug("TypeOfDevice " + xmlTypeOfDevice);
                            } catch (err) {
                                adapter.log.debug("Can not read deviceType of " + strLocation);
                                xmlDeviceType = "";
                            }

                            //Looking for the port
                            var strPort = strLocation.replace(/\bhttp:\/\/.*\d:/ig, "");
                            strPort = strPort.replace(/\/.*/ig, "");
                            if(strPort.match(/http:/ig) == true){strPort = '';}


                            //Looking for the IP of a device
                            strLocation = strLocation.replace(/http:\/\//g, "");
                            try{strLocation = strLocation.replace(/:\d*\/.*/ig, "");}
                            catch(err) { strLocation = strLocation.replace(/\/\w.*/ig, "");}

                            //Looking for UDN of a device
                            try {
                                xmlUDN = path.UDN;
                                xmlUDN = xmlUDN.toString().replace(/"/g, "");
                                xmlUDN = xmlUDN.replace(/uuid:/g, "");
                            } catch (err) {
                                adapter.log.debug("Can not read UDN of " + strLocation);
                                xmlUDN = "";
                            }

                            //Looking for the manufacturer of a device
                            try {
                                xmlManufacturer = path.manufacturer;
                                xmlManufacturer = xmlManufacturer.toString().replace(/"/g, "");
                            } catch (err) {
                                adapter.log.debug("Can not read manufacturer of " + strLocation);
                                xmlManufacturer = "";
                            }

                            //Extract the path to the device icon that is delivered by the device
                            var i_icons = 0;
                            var xmlIconURL;
                            var xmlFriendlyName;
                            var xmlFN;
                            var xmlManufacturerURL;
                            var xmlModelNumber;
                            var xmlModelDescription;
                            var xmlModelName;
                            var xmlModelURL;

                            try {
                                i_icons = path.iconList[0].icon.length;
                                adapter.log.debug("Number of icons: " + i_icons);

                                xmlIconURL = path.iconList[0].icon[0].url;
                                xmlIconURL = xmlIconURL.toString().replace(/"/g, "");
                            } catch (err) {
                                adapter.log.debug("Can not find a icon for " + strLocation);
                                xmlIconURL = "";
                            }

                            //Looking for the freiendlyName of a device
                            try {
                                xmlFriendlyName = path.friendlyName;
                                xmlFN = xmlFriendlyName.toString().replace(/\./g, "_");
                                xmlFN = xmlFN.replace(/"/g, "");
                                try{xmlFN = xmlFN.replace(/\s/g, "_");} catch(err){};
                            } catch (err) {
                                adapter.log.debug("Can not read friendlyName of " + strLocation);
                                xmlFriendlyName = "Unknown";
                            }

                            //Looking for the manufacturerURL
                            try {
                                xmlManufacturerURL = path.manufacturerURL;
                                xmlManufacturerURL = xmlManufacturerURL.toString().replace(/"/g, "");
                            } catch (err) {
                                adapter.log.debug("Can not read manufacturerURL of " + strLocation);
                                xmlManufacturerURL = "";
                            }

                            //Looking for the modelNumber
                            try {
                                xmlModelNumber = path.modelNumber;
                                xmlModelNumber = xmlModelNumber.toString().replace(/"/g, "");
                            } catch (err) {
                                adapter.log.debug("Can not read modelNumber of " + strLocation);
                                xmlModelNumber = "";
                            }

                            //Looking for the modelDescription
                            try {
                                xmlModelDescription = path.modelDescription;
                                xmlModelDescription = xmlModelDescription.toString().replace(/"/g, "");
                            } catch (err) {
                                adapter.log.debug("Can not read modelDescription of " + strLocation);
                                xmlModelDescription = "";
                            }

                            //Looking for the modelName
                            try {
                                xmlModelName = path.modelName;
                                xmlModelName = xmlModelName.toString().replace(/"/g, "");
                            } catch (err) {
                                adapter.log.debug("Can not read modelName of " + strLocation);
                                xmlModelName = "";
                            }

                            //Looking for the modelURL
                            try {
                                xmlModelURL = path.modelURL;
                                xmlModelURL = xmlModelURL.toString().replace(/"/g, "");
                            } catch (err) {
                                adapter.log.debug("Can not read modelURL of " + strLocation);
                                xmlModelURL = "";
                            }


                            //START - Creating the root object of a device
                            adapter.log.debug('creating root element for device: ' + xmlFN);

                            adapter.setObject(xmlFN + '.' + xmlTypeOfDevice, {
                                type: 'device',
                                common: {
                                    name: xmlFN,
                                    extIcon: "http://" + strLocation + ":" + strPort + xmlIconURL
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
                            var pathRoot = result.root.device[0];
                            var objectName = xmlFN + '.' + xmlTypeOfDevice;
                            creatServiceList(result, xmlFN, xmlTypeOfDevice, objectName, strLocation, strPort, pathRoot);
                            adapter.setObject(xmlFN + '.' + xmlTypeOfDevice + '.Alive', {
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
                            var i_SubDevices = 0;

                            var xmlfriendlyName;


                            if (path.deviceList && path.deviceList[0].device) {
                                //Counting SubDevices
                                i_SubDevices = path.deviceList[0].device.length;

                                adapter.log.debug("Number of SubDevieces: " + i_SubDevices);

                                if (i_SubDevices) {
                                    adapter.log.debug("Found more than one SubDevice");
                                    for (i = i_SubDevices - 1; i >= 0; i--) {

                                        adapter.log.debug("i and i_SubDevices: " + i + " " + i_SubDevices);
                                        adapter.log.debug("Device " + i + " " + path.deviceList[0].device[i].friendlyName);


                                        //Looking for deviceType of device
                                        try {
                                            xmlDeviceType = path.deviceList[0].device[i].deviceType;
                                            xmlDeviceType = xmlDeviceType.toString().replace(/"/g, "");
                                            xmlTypeOfDevice = xmlDeviceType.toString().replace(/:\d/, "");
                                            xmlTypeOfDevice = xmlTypeOfDevice.replace(/.*:/, "");
                                            adapter.log.debug("TypeOfDevice " + xmlTypeOfDevice);
                                        } catch (err) {
                                            adapter.log.debug("Can not read deviceType of " + strLocation);
                                            xmlDeviceType = "";
                                        }

                                        //Looking for the freiendlyName of the SubDevice
                                        try {
                                            xmlfriendlyName = path.deviceList[0].device[i].friendlyName;
                                            xmlfriendlyName = xmlfriendlyName.toString().replace(/\./g, "_");
                                            xmlfriendlyName = xmlfriendlyName.replace(/\"/g, "");
                                        } catch (err) {
                                            adapter.log.debug("Can not read friendlyName of SubDevice from " + xmlFN);
                                            xmlfriendlyName = "Unknown";
                                        }
                                        //Looking for the manufacturer of a device
                                        try {
                                            xmlManufacturer = path.deviceList[0].device[i].manufacturer;
                                            xmlManufacturer = xmlManufacturer.toString().replace(/\"/g, "");
                                        } catch (err) {
                                            adapter.log.debug("Can not read manufacturer of " + xmlfriendlyName);
                                            xmlManufacturer = "";
                                        }
                                        //Looking for the manufacturerURL
                                        try {
                                            xmlManufacturerURL = path.deviceList[0].device[i].manufacturerURL;
                                        } catch (err) {
                                            adapter.log.debug("Can not read manufacturerURL of " + xmlfriendlyName);
                                            xmlManufacturerURL = "";
                                        }
                                        //Looking for the modelNumber
                                        try {
                                            xmlModelNumber = path.deviceList[0].device[i].modelNumber;
                                        } catch (err) {
                                            adapter.log.debug("Can not read modelNumber of " + xmlfriendlyName);
                                            xmlModelNumber = "";
                                        }
                                        //Looking for the modelDescription
                                        try {
                                            xmlModelDescription = path.deviceList[0].device[i].modelDescription;
                                        } catch (err) {
                                            adapter.log.debug("Can not read modelDescription of " + xmlfriendlyName);
                                            xmlModelDescription = "";
                                        }
                                        //Looking for deviceType of device
                                        try {
                                            xmlDeviceType = path.deviceList[0].device[i].deviceType;
                                        } catch (err) {
                                            adapter.log.debug("Can not read DeviceType of " + xmlfriendlyName);
                                            xmlDeviceType = "";
                                        }
                                        //Looking for the modelName
                                        try {
                                            xmlModelName = path.deviceList[0].device[i].modelName;
                                        } catch (err) {
                                            adapter.log.debug("Can not read modelName of " + xmlfriendlyName);
                                            xmlModelName = "";
                                        }
                                        //Looking for the modelURL
                                        try {
                                            xmlModelURL = path.deviceList[0].device[i].modelURL;
                                        } catch (err) {
                                            adapter.log.debug("Can not read modelURL of " + xmlfriendlyName);
                                            xmlModelURL = "";
                                        }
                                        //Looking for UDN of a device
                                        try {
                                            xmlUDN = path.deviceList[0].device[i].UDN;
                                            xmlUDN = xmlUDN.toString().replace(/"/g, "");
                                            xmlUDN = xmlUDN.replace(/uuid:/g, "");
                                        } catch (err) {
                                            adapter.log.debug("Can not read UDN of " + xmlfriendlyName);
                                            xmlUDN = "";
                                        }

                                        //The SubDevice object
                                        adapter.setObject(xmlFN + '.' + xmlTypeOfDevice, {
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
                                        var pathSub = result.root.device[0].deviceList[0].device[i];
                                        var objectNameSub = xmlFN + '.' + xmlTypeOfDevice;
                                        creatServiceList(result, xmlFN, xmlTypeOfDevice, objectNameSub, strLocation, strPort, pathSub);
                                        adapter.setObject(xmlFN + '.' + xmlTypeOfDevice + '.Alive', {
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
                            //END - Creating SubDevices list for a device
                        }//END else
                        })
            } catch (error) {
                adapter.log.error('Cannot parse answer from ' + strLocation + ': ' + error);
            }
         }
    });
    return true;
}
//END Reading the xml device description file of each upnp device

//START Creating serviceList
function creatServiceList(result, xmlFN, xmlTypeOfDevice, object, strLocation, strPort, path){
    var i_services = 0;
    var i;
    var xmlService;
    var xmlServiceType;
    var xmlServiceID;
    var xmlControlURL;
    var xmlEventSubURL;
    var xmlSCPDURL;

    i_services = path.serviceList[0].service.length;

    //Counting services
    adapter.log.debug("Number of services: " + i_services);

    for (i = i_services - 1; i >= 0; i--) {

        try {
            xmlService = path.serviceList[0].service[i].serviceType;
            xmlService = xmlService.toString().replace(/urn:.*:service:/g, "");
            xmlService = xmlService.replace(/:\d/g, "");
            xmlService = xmlService.replace(/\"/g, "");
        } catch(err){
            adapter.log.debug("Can not read service of " +  xmlFN);
            xmlService = "Unknown";
        }

        try {
            xmlServiceType = path.serviceList[0].service[i].serviceType;
        } catch(err){
            adapter.log.debug("Can not read serviceType of " + xmlService);
            xmlServiceType = "";
        }

        try {
            xmlServiceID = path.serviceList[0].service[i].serviceId;
        } catch(err){
            adapter.log.debug("Can not read serviceID of " + xmlService);
            xmlServiceID = "";
        }

        try {
            xmlControlURL = path.serviceList[0].service[i].controlURL;
        } catch(err){
            adapter.log.debug("Can not read controlURL of " + xmlService);
            xmlControlURL = "";
        }

        try {
            xmlEventSubURL = path.serviceList[0].service[i].eventSubURL;
        } catch(err){
            adapter.log.debug("Can not read eventSubURL of " + xmlService);
            xmlEventSubURL = "";
        }

        try {
            xmlSCPDURL = path.serviceList[0].service[i].SCPDURL;
        } catch(err){
            adapter.log.debug("Can not read SCPDURL of " + xmlService);
            xmlSCPDURL = "";
        }

        adapter.log.debug(i + " " + xmlService + " " + xmlControlURL);

        //object = xmlFN + '.' + xmlTypeOfDevice + '.' + xmlfriendlyName + '.' +  xmlService;

        adapter.setObject(object + '.' +  xmlService, {
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

        adapter.setObject(object + '.' + xmlService + '.sid', {
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

        var SCPDlocation = "http://" + strLocation + ":" + strPort + xmlSCPDURL;
        var service = xmlFN + '.' + xmlTypeOfDevice + '.' +  xmlService;
        readSCPD(SCPDlocation, service);

    }
}
//END Creating serviceList

//START Read the SCPD File  of a upnp device service
function readSCPD(SCPDlocation, service){


    adapter.log.debug("readSCPD for " + SCPDlocation);

    request(SCPDlocation, function (error, response, body) {
        if (!error && response.statusCode == 200) {
            adapter.log.debug("Positive answer for request of the XML file for " + SCPDlocation);

            try {
                parseString(body, {
                            explicitArray: true

                    },
                    function (err, result) {
                        adapter.log.debug("Parsing the SCPD XML file for " + SCPDlocation);

                        if (err) {
                            adapter.log.warn("Error: " + err);
                        } else {
                            adapter.log.debug("Creating objects for " + SCPDlocation);

                            if (!result || !result.scpd) {
                                adapter.log.warn('Error by parsing of ' + SCPDlocation);
                                return;
                            } //END if

                            createServiceStateTable(result, service);
                            createActionList(result, service);

                        } //END if
                    } //END function
                ); //END parseString
            } catch (error) {
                adapter.log.error('Cannot parse answer from ' + SCPDlocation + ': ' + error);
            }
        }
        })
}
//END Read the SCPD File  of a upnp device service

//START Creating serviceStateTable
function createServiceStateTable(result, service){
    var i_stateVariable = 0;
    var i2 = 0;
    var i_allowedValue = 0;
    var path;
    var stateVariableAttr;
    var xmlName;
    var xmlDataType;
    var xmlAllowedValue;
    var strAllowedValues;
    var strDefaultValue;
    var strMinimum;
    var strMaximum;
    var strStep;

        try{path = result.scpd.serviceStateTable[0];} catch (err) {path = result.scpd.serviceStateTable};
         try{i_stateVariable = path.stateVariable.length;} catch(err){i_stateVariable = 1;};

        //Counting stateVariable's
        adapter.log.debug("Number of stateVariables: " + i_stateVariable);
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
                            var numberOfValue = xmlAllowedValue;
                            xmlAllowedValue = path.stateVariable[i2].allowedValueList[0].allowedValue[numberOfValue];
                            strAllowedValues = strAllowedValues + xmlAllowedValue + ' ';
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
                        ;
                    } catch (err) {
                    }

                    try {
                        strMaximum = path.stateVariable[i2].allowedValueRange[0].maximum;
                        try {
                            strMaximum = strMaximum.toString();
                        } catch (err) {
                        }
                        ;
                    } catch (err) {
                    }
                    try {
                        strStep = path.stateVariable[i2].allowedValueRange[0].step;
                        try {
                            strStep = strStep.toString();
                        } catch (err) {
                        }
                        ;
                    } catch (err) {
                    }


                    createService();
                }//END for
            } catch(err){}

    function createService() {
        //Handles DataType ui2 as Number
        var dataType;
        if(xmlDataType.toString() === 'ui2'){
            dataType = 'number';
        } else {
            dataType = xmlDataType.toString();
        }
        adapter.setObject(service + '.' + xmlName, {
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
    var i_action = 0;
    var i2;
    var path;
    var xmlName;

    path = result.scpd.actionList[0];
    try{i_action = path.action.length;} catch (err) {i_action = 1;};

    //Counting action's
    adapter.log.debug("Number of actions: " + i_action);

    if (i_action) {
        try {
            for (i2 = i_action - 1; i2 >= 0; i2--) {

                xmlName = path.action[i2].name;

                createAction();
            }
        }catch (err) {}

    }//END if

    function createAction(){
        adapter.setObject(service + '.' + xmlName, {
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
            adapter.log.debug("There is no argument for " + xmlName);
        }
    }
    //END Add serviceList for SubDevice

} //END function
//END Creating actionList



//START Creating argumentList
function createArgumentList(result, service, actionName, action_number, path){
    var i_argument = 0;
    var i2;
    var xmlName;
    var xmlDirection;
    var xmlrelStateVar;

    adapter.log.debug("Reading argumentList for " + actionName);

    try{i_argument = path.action[action_number].argumentList[0].argument.length;} catch (err){i_argument = 1;};

    //Counting arguments's
    adapter.log.debug("Number of argument's: " + i_argument);

    if (i_argument) {

        for (i2 = i_argument - 1; i2 >= 0; i2--) {

            try {
                xmlName = path.action[action_number].argumentList[0].argument[i2].name;
            } catch(err){
                adapter.log.debug("Can not read argument Name of " + actionName);
                xmlName = "Unknown";
            }

            try {
                xmlDirection = path.action[action_number].argumentList[0].argument[i2].direction;
            } catch(err) {
                adapter.log.debug("Can not read direction of " + actionName);
                xmlDirection = "";
            }

            try {
                xmlrelStateVar = path.action[action_number].argumentList[0].argument[i2].relatedStateVariable;
            } catch(err) {
                adapter.log.debug("Can not read relatedStateVariable of " + actionName);
                xmlrelStateVar = "";
            }
            createArgument();
        }
    }//END if

    function createArgument(){
        adapter.setObject(service + '.' + actionName + '.' + xmlName, {
            type: 'state',
            common: {
                name: xmlName.toString,
                role: 'argument',
                type: 'mixed',
                read: true,
                write: true
            },
            native: {direction: xmlDirection.toString(),
                relatedStateVariable: xmlrelStateVar.toString()}
        }); //END adapter.setObject()
    }
    //END Add argumentList for action

} //END function
//END Creating argumentList


//START Server for Alive and ByeBye messages
var own_uuid = 'uuid:f40c2981-7329-40b7-8b04-27f187aecfb5'; //this string is for filter message's from upnp Adapter
var Server = require('node-ssdp').Server
    , server = new Server({
    ssdpIp: '239.255.255.250',
});
//helper variables for start adding new devices
var devices;
var is_running;

//Identification of upnp Adapter/ioBroker as upnp Service and it's capabilities
//at this time there is no implementation of upnp service capabilities, it is only necessary for the server to run
server.addUSN('upnp:rootdevice');
server.addUSN('urn:schemas-upnp-org:device:IoTManagementandControlDevice:1');

server.on('advertise-alive', function (headers) {
    var usn = JSON.stringify(headers['USN']);
    usn = usn.toString();
    usn = usn.replace(/uuid:/ig, "");
    usn = usn.replace(/::.*/ig, '"');
    var nt = JSON.stringify(headers['NT']);
    var location = JSON.stringify(headers['LOCATION']);
    if(usn.match(/.*f40c2981-7329-40b7-8b04-27f187aecfb5.*/)) {
    } else {
        adapter.getDevices(function (err, devices) {
            var device;
            var device_id;
            var device_uuid;
            var device_usn;
            var found_uuid;
            for(device in devices){
                device_uuid = JSON.stringify(devices[device]['native']['uuid']);
                device_usn = JSON.stringify(devices[device]['native']['deviceType']);
                //Set object Alive for the Service true
                if(device_uuid == usn && device_usn == nt){
                    var max_age = JSON.stringify(headers['CACHE-CONTROL']);
                    try{max_age = max_age.replace(/max-age.=./ig, '');} catch(err){};
                    try{max_age = max_age.replace(/max-age=/ig, '');} catch(err){};
                    try{max_age = max_age.replace(/\"/ig, '');} catch(err){};
                    device_id = JSON.stringify(devices[device]['_id']);
                    device_id = device_id.replace(/\"/ig, '');
                    adapter.setState(device_id + '.Alive', {val: true, ack: true, expire: max_age});
                } //END if
                if(device_uuid == usn){
                    found_uuid = 'found';
                } //END if
            } //END for
            if(found_uuid != 'found') {
                adapter.log.debug('Found new device');
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
    var usn = JSON.stringify(headers['USN']);
    usn = usn.toString();
    usn = usn.replace(/uuid:/g, '');
    try{usn.replace(/::.*/ig, '')} catch(err) {};
    var nt = JSON.stringify(headers['NT']);
    var location = JSON.stringify(headers['LOCATION']);
    if(usn.match(/.*f40c2981-7329-40b7-8b04-27f187aecfb5.*/)) {
    } else {
        //adapter.log.debug('Device Dead' + usn + '; ' + nt + '; ' + location);
        adapter.getDevices(function (err, devices) {
            var device;
            var device_id;
            var device_uuid;
            var device_usn;
            for(device in devices){
                device_uuid = JSON.stringify(devices[device]['native']['uuid']);
                device_usn = JSON.stringify(devices[device]['native']['deviceType']);
                //Set object Alive for the Service false
                if(device_uuid == usn){
                    device_id = JSON.stringify(devices[device]['_id']);
                    device_id = device_id.replace(/\"/ig, '');
                    adapter.setState(device_id + '.Alive', {val: false, ack: true});
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
var service;
var device_ip;
var device_port;
var infoSub;
var answer;

//Subscribe to every service that is alive. Triggered by change alive from false/null to true.
function subscribe_event(id, state){
    service = id.replace(/\.Alive/ig, '');
    var alive = JSON.stringify(state['val']);
    if(alive == 'true') {
        adapter.getObject(service, function (err, obj) {
            device_ip = JSON.stringify(obj.native.ip);
            device_ip = device_ip.replace(/\"/ig, '');
            device_port = JSON.stringify(obj.native.port);
            device_port = device_port.replace(/\"/ig, '');
            //adapter.log.info('device ip: ' + device_ip + ' ' + device_port + ' '+ JSON.stringify(obj));

            adapter.getChannelsOf(obj.common.name, function (err, _channel) {
                    for (var x = _channel.length - 1; x >= 0; x--) {

                            var event_url;
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

    if (infoSub) {
        infoSub.on('subscribed', function (sid) {
            //adapter.log.info('SID: ' + JSON.stringify(sid) + ' ' + event_url + ' ' + _channel['_id']);
            var variabaleTimeout = +5;
            setTimeout(function(){adapter.setState(_channel._id + '.sid', {val: sid.sid, ack: true})}, variabaleTimeout);
            setTimeout(function(){variabaleTimeout = 0}, 100)
        });

        infoSub.on('message', function (obj) {
            adapter.log.info(' Message: ' + JSON.stringify(obj));
            events2objects(obj, _channel);
        });
        infoSub.on('error', function (obj) {
            adapter.log.info('Subscription error: ' + JSON.stringify(obj));
        });

        infoSub.on('resubscribed', function (sid) {
            //adapter.log.info('SID: ' + JSON.stringify(sid) + ' ' + event_url + ' ' + _channel['_id']);
            var variabaleTimeout = +5;
            setTimeout(function(){adapter.setState(_channel._id + '.sid', {val: sid.sid, ack: true})}, variabaleTimeout);
            setTimeout(function(){variabaleTimeout = 0}, 100)
        });
    } //END if
} //END function listener()


var arrSID = [];
var state;
//Get all .sid Objects for the services and build an array, that is used as index to find them faster
function events2objects(data, _channel){
    var lookup;
    var arrLength = arrSID.length;
    if(arrLength == 0){
        //Fill array arrSID if it is empty
        adapter.getStatesOf('upnp.' + adapter.instance, function(err, _states){
            var statesLength = _states.length;

                for(var x = statesLength -1; x >= 0; x--){
                    if(JSON.stringify(_states[x]['_id']).match(/\.sid/g) == null){
                        //if the match deliver null nothing is to do
                    }else{
                        //if the match deliver an id of an object add them to the array
                        arrSID.push(_states[x]['_id']);
                    }
                } //END for
        }); //END adapter.getStatesOf()
        //When the array is filled start the search
        lookup = new lookup_service(data, arrLength);
    }else{
        //Start Search
        lookup = new lookup_service(data, arrLength);
    } //END if

    var sid = JSON.stringify(data['sid']);
} //END function events2object


function lookup_service(data, arrLength){
    var counter = 0;
    counter = arrLength;
    for(var y = arrLength -1; y >= 0; y--){
        //Get a state from the list in arrSID
        adapter.getState(arrSID[y], function(err, obj){
            counter = counter - 1;
            var sNS = new setNewState(obj, counter, data)
        });
    }//END for
}

function setNewState(obj, count, data){
    try{var varsid = obj['val'];} catch(err){} //Extract the value of the state
    //adapter.log.info(JSON.stringify('varsid: ' + varsid));

    if(varsid != null){
        //adapter.log.debug('Obejkt danach: ' + JSON.stringify(test));
        var helper = JSON.stringify(data['sid']); //Get the sid from actual message
        var helper2 = helper.replace(/\"/ig, "");
        var searchString = new RegExp(helper2, 'ig'); //Create a regular expression with the sid of actual message
        var found = varsid.match(searchString);
        //adapter.log.debug('Match: ' + found + ' ' + varsid + ' ' + searchString);

        if(found != null) {
            var serviceID = arrSID[count];
            serviceID = serviceID.replace(/\.sid/ig, '');
            //adapter.log.info('Gefunden: ' + JSON.stringify(data));

            //Select sub element with States
            var newStates;
                newStates = data['body']['e:propertyset']['e:property'];

            try{
                newStates = newStates['LastChange']['_'];
            } catch (err) {}

            if(newStates == undefined){
                newStates = data['body']['e:propertyset']['e:property']['LastChange'];
            }

            //try{adapter.log.info('newStates: ' + newStates);} catch(err){};

            var newStates2 = JSON.stringify(newStates);

            if(newStates2.match(/<Event.*/ig) != null){
                parseString(newStates, function(err, result) {
                    var states = new convertEventObject(result['Event']);

                    //split everey array meber into state name and value, then push it to iobroker state
                    var state_name;
                    var val;
                    var channel;
                    for(var x = states.length -1; x >= 0; x--){
                        //adapter.log.debug('Array Element Nr. ' + x + ': ' + states[x].toString());
                        var strState = states[x].toString();
                        state_name = strState.match(/\"\w*/i);
                        state_name = state_name.toString();
                        state_name = state_name.replace(/\"/i, "");

                        //looking for the value
                        val = strState.match(/val\":\"(\w*(:\w*|,\s\w*)*)/ig);
                        if(val != null) {
                            val = val.toString();
                            val = val.replace(/val\":\"/ig, "");
                        }

                        //looking for the value of channel
                        channel = strState.match(/channel\":\"(\w*(:\w*|,\s\w*)*)/ig);
                        if(channel != null) {
                            channel = channel.toString();
                            channel = channel.replace(/channel\":\"/ig, "");
                            adapter.setState(serviceID + '.' + 'A_ARG_TYPE_Channel', {val: channel, ack: true})
                        }
                        adapter.setState(serviceID + '.' + state_name, {val: val, ack: true})
                    }
                }) //END parseString()
            } //END if Event



            try {
                for (var x = newStates.langth - 1; x >= 0; x--) {
                    adapter.log.info('state:' + JSON.stringify(newStates[x]));
                }
            } catch(err){}

        } //END if
    } //END if
}
//Not used now
function convertEvent(data){
        var change = data.replace(/<\\.*>/ig, '{"');
        change = data.replace(/</ig, '{"');
        change = change.replace(/\s/ig, '""');
        change = change.replace(/=/ig, ':');
        change = change.replace(/\\/ig, '');
        change = change.replace(/>/ig, '}');
}

//convert the event JSON into an array
function convertEventObject(result) {
    var regex = new RegExp(/\"\w*\":\[{\"\$\":{(\"\w*\":\"(\w*:\w*:\w*|(\w*,\s\w*)*|\w*)\"(,\"\w*\":\"\w*\")*)}/ig);
    var strResult = JSON.stringify(result);
    var matches = strResult.match(regex);
    return matches;
}


//END Event listener
var upnp_instance = 'upnp.' + adapter.instance;
//START clear Alive and sid's states when Adapter stops
function clearAsStates(){
    //Clear sid
    var arrLength = arrSID.length;
    if(arrLength != 0){
        for(var x = arrLength; x >= 0; x--){
            try{adapter.setState(arrSID[x], {val: '', ack: true})
            } catch(err) {}
        } //END for
    } //END if

    //Clear Alive
    arrLength = arrAlive.length;
    if(arrLength != 0){
        for(var y = arrLength; y >= 0; y--){
            try{adapter.setState(arrAlive[y], {val: 'false', ack: true})
            } catch(err) {}
        } //END for
    } //END if

    adapter.log.info('Alive and sid states cleared');
}
//END clear Alive and sid's

function createAliveArr(){
    adapter.getStatesOf('upnp.' + adapter.instance, function(err, _states){
        var arrLength = arrAlive.length;
        var statesLength = _states.length;
        if(arrLength == 0) {

            for (var x = statesLength - 1; x >= 0; x--) {
                if (JSON.stringify(_states[x]['_id']).match(/\.Alive/g) == null) {
                    //if the match deliver null nothing is to do
                } else {
                    arrAlive.push(_states[x]['_id']);
                }
            } //END for
        } //END if
    }); //END adapter.getStatesOf()
}
