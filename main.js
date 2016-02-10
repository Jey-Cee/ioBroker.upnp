/**
 *
 * template adapter
 *
 *
 *  file io-package.json comments:
 *
 *  {
 *      "common": {
 *          "name":         "upnp-discovery",                  					// name has to be set and has to be equal to adapters folder name and main file name excluding extension
 *          "version":      "0.1.0",                    						// use "Semantic Versioning"! see http://semver.org/
 *          "title":        "Upnp Discovery Adapter",  							// Adapter title shown in User Interfaces
 *          "authors":  [                               						// Array of authord
 *              "Jey Cee <jey-cee@live.com>"
 *          ]
 *          "desc":         "Discovers Upnp clients on the Network",          	// Adapter description shown in User Interfaces. Can be a language object {de:"...",ru:"..."} or a string
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
var utils =    require(__dirname + '/lib/utils'); // Get common adapter utils

//include node-ssdp
var Client = require('node-ssdp').Client
	,client = new Client();


// you have to call the adapter function and pass a options object
// name has to be set and has to be equal to adapters folder name and main file name excluding extension
// adapter will be restarted automatically every time as the configuration changed, e.g system.adapter.template.0
var adapter = utils.adapter('upnp-discovery');

// is called when adapter shuts down - callback has to be called under any circumstances!
adapter.on('unload', function (callback) {
    try {
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
    adapter.log.info('stateChange ' + id + ' ' + JSON.stringify(state));

    // you can use the ack flag to detect if it is status (true) or command (false)
    if (state && !state.ack) {
        adapter.log.info('ack is not set!');
    }
});



// is called when databases are connected and adapter received configuration.
// start here!
adapter.on('ready', function () {
    main();
});

var IPs = []; //Array for the catched broadcast answers

function main() {
adapter.log.debug("main Function");
	
	var filteredIPs = []; 
	
	sendBroadcastToAll();
	
	//Filtering the Device description file addresses, timeout is necessary to wait for all answers
	setTimeout(function ipFilter(){
		adapter.log.debug(IPs.length + " answers recived");
		for (var i = 0; i < IPs.length; i++){
				var ip;
				 ip = IPs[i];
				var testIP = filteredIPs.every(function checkIP(fIP){return fIP != IPs[i];});
				if (testIP == true){
					filteredIPs.push(IPs[i])
				}
			};
		adapter.log.debug("Found " + filteredIPs.length + " device description files");
		
		filteredIPs.every(firstDevLookup);
	}, 5000);
	

};

function sendBroadcastToAll(){
	adapter.log.debug("Send Broadcast")
	//Sends a Broadcast and catch the URL with xml device description file
	client.on('response', function (headers, statusCode, rinfo) {   
		var strHeaders = JSON.stringify(headers, null, ' ');
		var jsonAnswer = JSON.parse(strHeaders);
		var answer = jsonAnswer.LOCATION;
		
		IPs.push(answer);
		
	});
	
client.search('ssdp:all');

};


//Reading the xml device description file of each upnp device the first time
function firstDevLookup(strLocation) {
    var xmlAnswer;
    var parseString = require('xml2js').parseString;
    var request = require('request');
    
	adapter.log.debug("firstDevLookup function");
	
    request(strLocation, function (error, response, body) {
        if (!error && response.statusCode == 200) {

		adapter.log.debug("Positiv answer to request the XML file");
        
        parseString(body, {
              explicitArray: false,
               mergeAttrs: true
            }, 
            function (err, result) {
				
				adapter.log.debug("Parsing the XML file");
				
                if (err) {
                adapter.log.warn("Error: " + err);
                } else {
					
					adapter.log.debug("Creating objects");
				var i;
				
			//Looking for deviceType of device
				var xmlDeviceType = JSON.stringify(result.root.device.deviceType)
				xmlDeviceType = xmlDeviceType.replace(/\"/g, "");
				
				//Looking for the port
                var strPort = strLocation.replace(/\bhttp\:\/\/.*\d\:/ig, "");
				strPort = strPort.replace(/\/.*/ig, "");
				
			//Looking for the IP of a device
                strLocation = strLocation.replace(/http\:\/\//g, ""); 
                strLocation = strLocation.replace(/\:\d*\/.*/ig, "");
                

			//Looking for UDN of a device 
				var xmlUDN = JSON.stringify(result.root.device.UDN);
                xmlUDN = xmlUDN.replace(/\"/g, "");                
                xmlUDN = xmlUDN.replace(/uuid\:/g, "");
				
			//Looking for the manufacturer of a device
				var xmlManufacturer = JSON.stringify(result.root.device.manufacturer);
                xmlManufacturer = xmlManufacturer.replace(/\"/g, "");
                
			//Extract the path to the device icon that is delivered by the device
				var i_icons = 0;
				var xmlIconURL;
				
				for(i = 1; i < result.root.device.iconList.icon.length; i++){
					i_icons = i_icons + 1;
				};
				adapter.log.debug("Number of icons: " + i);
                
				if (i_icons > 1){
					xmlIconURL =  result.root.device.iconList.icon[1].url;
					adapter.log.debug("More than one icon in the list: " + xmlIconURL);}
				else {
						xmlIconURL = JSON.stringify(result.root.device.iconList.icon.url);
						adapter.log.debug("Only one icon in the list: " + xmlIconURL)
					};
				xmlIconURL = xmlIconURL.replace(/\"/g, "");
				
            //Looking for the freiendlyName of a device
				var xmlFriendlyName = JSON.stringify(result.root.device.friendlyName);
                var xmlFN = xmlFriendlyName.replace(/\./g, "_");
                xmlFN = xmlFN.replace(/\"/g, ""); 
				
			//Looking for the manufacturerURL
				var xmlManufacturerURL = JSON.stringify(result.root.device.manufacturerURL);
				xmlManufacturerURL = xmlManufacturerURL.replace(/\"/g, ""); 
				
			//Looking for the modelNumber
				var xmlModelNumber = JSON.stringify(result.root.device.modelNumber);
				xmlModelNumber = xmlModelNumber.replace(/\"/g, ""); 
				
			//Looking for the modelDescription
				var xmlModelDescription = JSON.stringify(result.root.device.modelDescription);
				xmlModelDescription = xmlModelDescription.replace(/\"/g, ""); 
				
			//Looking for the modelName
				var xmlModelName = JSON.stringify(result.root.device.modelName);
				xmlModelName = xmlModelName.replace(/\"/g, ""); 
				
			//Looking for the modelURL
				var xmlModelURL = JSON.stringify(result.root.device.modelURL);
				xmlModelURL = xmlModelURL.replace(/\"/g, ""); 
				
			//START - Creating the root object of a device
				adapter.log.debug('creating root element for device: ' + xmlFN);
				adapter.setObject(xmlFN, {
					type: 'device',
					common: {
						name: xmlFN,
						extIcon: "http://" + strLocation + ":" + strPort + xmlIconURL,
					},
					native: {	ip: 				strLocation,
								port: 				strPort,
								uuid: 				xmlUDN,
								deviceType: 		xmlDeviceType,
								manufacturer: 		xmlManufacturer,
								manufacturerURL: 	xmlManufacturerURL,
								modelNumber: 		xmlModelNumber,
								modelDescription: 	xmlModelDescription,
								modelName:			xmlModelName,
								modelURL: 			xmlModelURL,
							
							},
				});
            //END - Creating the root object of a device
				
            
			
			//START - Creating service list for a device
				var i_services = 0;
				var xmlService;
				var xmlServiceType;
				var xmlServiceID;
				var xmlControlURL;
				var xmlEventSubURL;
				var xmlSCPDURL;
				
				//Counting services 
				for(i = 1; i < result.root.device.serviceList.service.length; i++){
					i_services = i_services + 1; };
				adapter.log.debug("Number of services: " + i_services);
				
				
				if (i_services > 1){
					adapter.log.debug("Found more than one service");
					for(i = i_services; i > 0; i--){
						
						xmlService 		= 	result.root.device.serviceList.service[i].serviceType;
						xmlServiceType 	= 	result.root.device.serviceList.service[i].serviceType;
						xmlServiceID 	= 	result.root.device.serviceList.service[i].serviceId;
						xmlControlURL 	= 	result.root.device.serviceList.service[i].controlURL;
						xmlEventSubURL 	= 	result.root.device.serviceList.service[i].eventSubURL;
						xmlSCPDURL 		= 	result.root.device.serviceList.service[i].SCPDURL;
						
						xmlService = xmlService.replace(/urn:.*:service:/g, "");
						xmlService = xmlService.replace(/:\d/g, "");
						xmlService = xmlService.replace(/\"/g, "");
					
						
						adapter.log.debug(i + " " + xmlService + " " + xmlControlURL);
						
					adapter.setObject(xmlFN + '.' + xmlService, {
						type: 'enum',
						common: {
							name: xmlService,
						
						},
						native: {
							serviceType:	xmlServiceType,
							serviceID: 		xmlServiceID,
							controlURL: 	xmlControlURL,
							eventSubURL: 	xmlEventSubURL,
							SCPDURL: 		xmlSCPDURL,
						},
					});
					//Dummy State
					adapter.setObject(xmlFN + '.' + xmlService + '.dummyState', {
						type: 'state',
						common: {
							name: 'Dummy State',
							type: 'boolean',
							role: 'indicator.test',
							write: false,
							read: true
					
							},
							//native: {}
						});
					};

				}
				else
				{adapter.log.debug("Found only one service");
				xmlService 		= JSON.stringify(result.root.device.serviceList.service.serviceType);				
				xmlService 		= xmlService.replace(/urn:.*:service:/g, "");
				xmlService 		= xmlService.replace(/:\d/g, "");
				xmlService 		= xmlService.replace(/\"/g, "");				
				adapter.log.debug(xmlService);
                
				xmlServiceType 	= JSON.stringify(result.root.device.serviceList.service.serviceType);
				xmlServiceType	= xmlServiceType.replace(/\"/g, "");
				xmlServiceID 	= JSON.stringify(result.root.device.serviceList.service.serviceId);
				xmlServiceID	= xmlServiceID.replace(/\"/g, "");
				xmlControlURL 	= JSON.stringify(result.root.device.serviceList.service.controlURL);
				xmlControlURL	= xmlControlURL.replace(/\"/g, "");
				xmlEventSubURL 	= JSON.stringify(result.root.device.serviceList.service.eventSubURL);
				xmlEventSubURL	= xmlEventSubURL.replace(/\"/g, "");
				xmlSCPDURL 		= JSON.stringify(result.root.device.serviceList.service.SCPDURL);
				xmlSCPDURL		= xmlSCPDURL.replace(/\"/g, "");
				
					adapter.setObject(xmlFN + '.' + xmlService, {
						type: 'enum',
						common: {
							name: xmlService,
						
						},
						native: {
							serviceType:	xmlServiceType,
							serviceID: 		xmlServiceID,
							controlURL: 	xmlControlURL,
							eventSubURL: 	xmlEventSubURL,
							SCPDURL: 		xmlSCPDURL,
						},
					});
					//Dummy State
						adapter.setObject(xmlFN + '.' + xmlService + '.dummyState', {
							type: 'state',
							common: {
								name: 'Dummy State',
								type: 'boolean',
								role: 'indicator.test',
								write: false,
								read: true
								},
							//native: {}
						});				
                
					}
                }
			//END - Creating service list for a device
			
			
			
			//START - Creating SubDevices list for a device
				var i_SubDevices = 0;
				var varSubDevices = result.root.device.deviceList;
				var xmlfriendlyName;
				
				if (typeof varSubDevices != 'undefined'){

						//Counting SubDevices
						for(i = 1; i < result.root.device.deviceList.device.length; i++){
							i_SubDevices = i_SubDevices + 1; };
						adapter.log.debug("Number of SubDevieces: " + i_SubDevices);
						
						if (i_SubDevices >= 1){
							adapter.log.debug("Found more than one SubDevice");
							for(i = i_SubDevices; i >= 0; i--){
								adapter.log.debug("i and i_SubDevices: " + i + " " + i_SubDevices);
								adapter.log.debug("Device " + i + " " + result.root.device.deviceList.device[i].friendlyName)
								//Looking for the freiendlyName of the SubDevice
								xmlfriendlyName = result.root.device.deviceList.device[i].friendlyName;
								xmlfriendlyName = xmlFriendlyName.replace(/\./g, "_");
								//xmlfriendlyName = xmlfriendlyName.replace(/\"/g, "");
								//Looking for the manufacturer of a device
								xmlManufacturer = result.root.device.deviceList.device[i].manufacturer;
								xmlManufacturer = xmlManufacturer.replace(/\"/g, "");
								//Looking for the manufacturerURL, kills the Adapter
								//xmlManufacturerURL = result.root.device.device.deviceList.device[i].manufacturerURL;
								//Looking for the modelNumber										   
								xmlModelNumber = result.root.device.deviceList.device[i].modelNumber; 
								//Looking for the modelDescription
								xmlModelDescription = result.root.device.deviceList.device[i].modelDescription;
								//Looking for deviceType of device
								xmlDeviceType = result.root.device.deviceList.device[i].deviceType;
								//Looking for the modelName
								xmlModelName = result.root.device.deviceList.device[i].modelName;
								//Looking for the modelURL
								xmlModelURL = result.root.device.deviceList.device[i].modelURL;
								//Looking for UDN of a device 
								xmlUDN = result.root.device.deviceList.device[i].UDN;
								xmlUDN = xmlUDN.replace(/\"/g, "");                
								xmlUDN = xmlUDN.replace(/uuid\:/g, "");
								
								//The SubDevice object
								adapter.setObject(xmlFN + '.' + xmlfriendlyName, {
									type: 'device',
										common: {
										name: 	xmlfriendlyName,
										},
									native: {	uuid: 				xmlUDN,
												deviceType: 		xmlDeviceType,
												manufacturer: 		xmlManufacturer,
												//manufacturerURL: 	xmlManufacturerURL,
												modelNumber: 		xmlModelNumber,
												modelDescription: 	xmlModelDescription,
												modelName:			xmlModelName,
												modelURL: 			xmlModelURL,
									},
								}); //END Object
								
								//Dummy State
									adapter.setObject(xmlFN + '.' + xmlfriendlyName + '.dummyState', {
										type: 'state',
										common: {
											name: 'Dummy State',
											type: 'boolean',
											role: 'indicator.test',
											write: false,
											read: true
											},
										//native: {}
									});
								
							};	//END for
						}
						else
						{
							//Looking for the freiendlyName of the SubDevice
							xmlfriendlyName = JSON.stringify(result.root.device.deviceList.device.friendlyName);
							xmlfriendlyName = xmlFriendlyName.replace(/\./g, "_");
							xmlfriendlyName = xmlfriendlyName.replace(/\"/g, "");
							//Looking for the manufacturer of a device
							xmlManufacturer = JSON.stringify(result.root.device.deviceList.device.manufacturer);
							xmlManufacturer = xmlManufacturer.replace(/\"/g, "");
							//Looking for the manufacturerURL
							//xmlManufacturerURL = JSON.stringify(result.root.device.devices.deviceList.device.manufacturerURL);
							//xmlManufacturerURL = xmlManufacturerURL.replace(/\"/g, ""); 
							//Looking for the modelNumber
							xmlModelNumber = JSON.stringify(result.root.device.deviceList.device.modelNumber);
							xmlModelNumber = xmlModelNumber.replace(/\"/g, "");
							//Looking for the modelDescription
							xmlModelDescription = JSON.stringify(result.root.device.deviceList.device.modelDescription);						//Looking for deviceType of device
							xmlModelDescription = xmlModelDescription.replace(/\"/g, ""); 
							//Looking for the DeviceType
							xmlDeviceType = JSON.stringify(result.root.device.deviceList.device.deviceType);
							xmlDeviceType = xmlDeviceType.replace(/\"/g, "");
							//Looking for the modelName
							xmlModelName = JSON.stringify(result.root.device.deviceList.device.modelName);
							xmlModelName = xmlModelName.replace(/\"/g, ""); 
							//Looking for the modelURL
							xmlModelURL = JSON.stringify(result.root.device.deviceList.device.modelURL);
							xmlModelURL = xmlModelURL.replace(/\"/g, "");
							//Looking for UDN of a device 
							xmlUDN = JSON.stringify(result.root.device.deviceList.device.UDN);
							xmlUDN = xmlUDN.replace(/\"/g, "");                
							xmlUDN = xmlUDN.replace(/uuid\:/g, "");
							
							//The SubDevice object
							adapter.setObject(xmlFN + '.' + xmlfriendlyName, {
								type: 'device',
									common: {
									name: 	xmlfriendlyName,
									},
								native: {	uuid: 				xmlUDN,										
											deviceType: 		xmlDeviceType,
											manufacturer: 		xmlManufacturer,
											//manufacturerURL: 	xmlManufacturerURL,
											modelNumber: 		xmlModelNumber,
											modelDescription: 	xmlModelDescription,
											modelName:			xmlModelName,
											modelURL: 			xmlModelURL,			
								},
							});
							
						}	//END if
				} //END if
			//END - Creating SubDevices list for a device
            });
    //} else  {
        //adapter.log.warn(error);
    }
    });
  return true;  
}
