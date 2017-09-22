/**
 * Created by Jey Cee on 30.06.2017.
 */
'use strict';

var fs = require('fs');
var request = require('request');

var adapter;

function getAdapter(item){
    adapter = item;
}

function createPlayerStates(){
    var arrMedia = ["play", "pause", "stop"];
    var arrAudio = ["volume_up", "volume_down", "mute"];
    var varDevice = "";

    adapter.getStatesOf('upnp.' + adapter.instance, function(err, _states){
        var statesLength = _states.length;

            for (var x = statesLength - 1; x >= 0; x--) {
                if (JSON.stringify(_states[x]['_id']).match(/\.MediaRenderer.Alive/g) == null) {
                    //if the match deliver null nothing is to do
                } else {
                    varDevice = _states[x]['_id'];
                    varDevice = varDevice.replace('.MediaRenderer.Alive', "")


    arrAudio.forEach(function(item, index){
        adapter.setObject(varDevice + '.Player.AudioControl.' + item, {
            type: 'state',
            common: {
                name: item,
                type: 'boolean',
                read: true,
                write: true,
                role: 'media.' + item
            },
            native: {

            }
        });
    });

    arrMedia.forEach(function(item, index){
        adapter.setObject(varDevice + '.Player.MediaControl.' + item, {
            type: 'state',
            common: {
                name: item,
                type: 'boolean',
                read: true,
                write: true,
                role: 'media.' + item
            },
            native: {

            }
        });
    });

    adapter.setObject(varDevice + '.Player.MediaControl.mediaURL', {
        type: 'state',
        common: {
            name: 'mediaURL',
            type: 'string',
            read: true,
            write: true,
            role: 'media.input'
        },
        native: {
        }
    });

    adapter.setObject(varDevice + '.Player.MediaControl.randomPlay', {
        type: 'state',
        common: {
            name: 'randomPlay',
            type: 'string',
            read: true,
            write: true,
            role: 'media.random'
        },
        native: {
        }
    });
                }
            } //END for
    }); //END adapter.getStatesOf()

    /*adapter.setObject('Player.playersOn', {  //Veraltet wurde nur in der Single player version genutzt
        type: 'state',
        common: {
            name: 'Available Players',
            type: 'string',
            read: true,
            write: true,
            role: 'indicator'
        },
        native: {
        }
    });

    adapter.setObject('Player.nowControlling', {
        type: 'state',
        common: {
            name: 'Now Controlling',
            type: 'string',
            read: true,
            write: true,
            role: 'indicator'
        },
        native: {
        }
    });*/
}

/*function setAvailablePlayers(stateID, alive){     //Veraltet, wurde für die Single player version genutzt
    var patt = new RegExp(/\.MediaRenderer\./g);
    var testMR =  patt.test(stateID);
    if (testMR == true) {
        var id = stateID.replace(/upnp\.\d\./g, '');
        id = id.replace('.MediaRenderer.Alive', '');
        adapter.getState('Player.playersOn', function (err, state){
            var value = state.val;
            var strSearch;
            try{strSearch = id.replace(/\(/g, '.');}catch(err){}
            try{strSearch = strSearch.replace(/\)/g, '.');}catch(err){}
            try{strSearch = strSearch.replace(/\[/g, '.');}catch(err){}
            try{strSearch = strSearch.replace(/\]/g, '.');}catch(err){}
            var patt = new RegExp(strSearch, 'g');
            var test = patt.test(value);


            if(alive === true) {
                if (test === false) {
                    value = id + '; ' + value;
                    adapter.setState('Player.playersOn', value, true);
                }
            } else if (alive === false){
                if (test === true) {
                    value = value.replace(id + ';', '');
                    adapter.setState('Player.playersOn', value, true);
                }
            }

        })


    }

}*/
var track;
var playlist;

function main(id, state){
        //console.log('state: ' + JSON.stringify(id) + ' ' + JSON.stringify(state));
        var value = state.val;

        //get control command
        if(value === true) {
            var patt = new RegExp(/.*\./g);
            id = id.toString();
            var control = id.replace(patt, '');
            var patt2 = new RegExp(/\.Player\..*\..*/g)
            var playerID = id.replace(patt2, "");
            adapter.log.info(playerID);


            switch (control) {
                case 'play':
                    adapter.log.info('play');
                    play(playerID);
                    break;

                case 'pause':
                    pause(playerID);
                    break;

                case 'stop':
                    stop(playerID);
                    break;

                case 'mute':
                    mute(playerID);
                    break;

                case 'volume_up':
                    volume_up(playerID);
                    break;

                case 'volume_down':
                    volume_down(playerID);
                    break;

                case 'randomPlay':
                    randomPlay(playerID);
                    break;

            }
        }else if(value !== '' || value !== null) {
            adapter.log.debug('if value != 0');
            var pattURL = new RegExp(/\.mediaURL/g);
            id = id.toString();
            var testURL = pattURL.test(id);

            if (testURL === true) {
                console.log('if testURL === true');
                var pattMP3 = new RegExp(/\.mp3$/g);
                var testMP3 = pattMP3.test(value);

                if (testMP3 === true) {
                    track = value;
                }

                var pattM3U = new RegExp(/\.m3u$/g);
                var testM3U = pattM3U.test(value);

                if (testM3U === true) {
                    console.log('if testM3U === true')
                    readPlaylist(value);
                }
            }
        }
}

//control functions
function play(playerID){


        //if(track !== '' && track !== null && track !== undefined) {
            /*adapter.log.info('single track');
            adapter.setState(playerID + '.MediaRenderer.AVTransport.SetAVTransportURI.InstanceID', 0);
            adapter.setState(playerID + '.MediaRenderer.AVTransport.SetAVTransportURI.CurrentURI', track);
            adapter.setState(playerID + '.MediaRenderer.AVTransport.SetAVTransportURI', 'send');*/

            setTimeout(function(){
                adapter.setState(playerID + '.MediaRenderer.AVTransport.Play.InstanceID', 0);
                adapter.setState(playerID + '.MediaRenderer.AVTransport.Play.Speed', 1);
                adapter.setState(playerID + '.MediaRenderer.AVTransport.Play', 'send');
            }, 15);
        /*}else if(playlist !== '' && playlist !== null && playlist !== undefined){
                adapter.log.info('playlist');
                var player = new PlayPlaylist('value');
                player.play(playlist);
                setTimeout(function(){
                    playlist = '';
                }, 10);
        }*/



        setTimeout(function(){
            adapter.setState(playerID + '.Player.MediaControl.play', false);
            adapter.setState(playerID + '.Player.MediaControl.mediaURL', '');
            track = '';
            }, 150);

}

function PlayPlaylist(name){
    this.name = name;
}

PlayPlaylist.prototype = {
    play: function(list){
        var noOfTracks = list.length;
        console.log('Tracks in Playlist: ' + noOfTracks);

        (function myLoop (i) {
            setTimeout(function () {
                console.log('Track Nummer: ' + i);
                if (--i) myLoop(i);      //  decrement i and call myLoop again if i > 0
            }, 1000)
        })(noOfTracks -1);

    }
};

function pause(playerID){

        adapter.setState(playerID + '.MediaRenderer.AVTransport.Pause.InstanceID', 0);
        adapter.setState(playerID + '.MediaRenderer.AVTransport.Pause', 'send');
        setTimeout(function(){adapter.setState(playerID + '.Player.MediaControl.pause', false);}, 150);


}

function stop(playerID){

        adapter.setState(playerID + '.MediaRenderer.AVTransport.Stop.InstanceID', 0);
        adapter.setState(playerID + '.MediaRenderer.AVTransport.Stop', 'send');
        setTimeout(function(){adapter.setState(playerID + '.Player.MediaControl.stop', false);}, 150);

}

function mute(playerID){

        adapter.setState(playerID + '.MediaRenderer.RenderingControl.GetMute.Channel', 'Master');
        adapter.setState(playerID + '.MediaRenderer.RenderingControl.GetMute.InstnaceID', 0);
        adapter.setState(playerID + '.MediaRenderer.RenderingControl.GetMute', 'send');
        setTimeout(function() {
            adapter.getState(playerID + '.MediaRenderer.RenderingControl.Mute', function (err, state) {
                var oldMute = state.val;
                console.log('oldMute: ' + oldMute);
                if (oldMute == 0) {
                    adapter.setState(playerID + '.MediaRenderer.RenderingControl.SetMute.InstanceID', 0);
                    adapter.setState(playerID + '.MediaRenderer.RenderingControl.SetMute.Channel', 'Master');
                    adapter.setState(playerID + '.MediaRenderer.RenderingControl.SetMute.DesiredMute', 1);
                    adapter.setState(playerID + '.MediaRenderer.RenderingControl.SetMute', 'send');
                } else {
                    adapter.setState(playerID + '.MediaRenderer.RenderingControl.SetMute.InstanceID', 0);
                    adapter.setState(playerID + '.MediaRenderer.RenderingControl.SetMute.Channel', 'Master');
                    adapter.setState(playerID + '.MediaRenderer.RenderingControl.SetMute.DesiredMute', 0);
                    adapter.setState(playerID + '.MediaRenderer.RenderingControl.SetMute', 'send');
                }
                setTimeout(function () {
                    adapter.setState(playerID + '.Player.AudioControl.mute', false);
                }, 150);
            })
        }, 200);

}

function volume_up(playerID){

        adapter.setState(playerID + '.MediaRenderer.RenderingControl.GetVolume.Channel', 'Master');
        adapter.setState(playerID + '.MediaRenderer.RenderingControl.GetVolume.InstanceID', 0);
        adapter.setState(playerID + '.MediaRenderer.RenderingControl.GetVolume', 'send');
        setTimeout(function() {
            adapter.getObject(playerID + '.MediaRenderer.RenderingControl.Volume', function(err, obj){
                var maxVol = obj.native.maximum;
                adapter.getState(playerID + '.MediaRenderer.RenderingControl.Volume', function (err, state) {
                    var oldVol = state.val;
                    var volInPercent = maxVol/100;
                    var newVol = parseInt(oldVol) + volInPercent * 5; //der Wert um den die Lautstärke geändert wird, kann beliebig geändert werden

                    //neue Lautstärke senden
                    adapter.setState(playerID + '.MediaRenderer.RenderingControl.SetVolume.Channel', 'Master');
                    adapter.setState(playerID + '.MediaRenderer.RenderingControl.SetVolume.DesiredVolume', newVol);
                    adapter.setState(playerID + '.MediaRenderer.RenderingControl.SetVolume.InstanceID', 0);
                    adapter.setState(playerID + '.MediaRenderer.RenderingControl.SetVolume', 'send');

                    setTimeout(function () {
                        adapter.setState(playerID + '.Player.AudioControl.volume_up', false);
                    }, 150);
                })
            })
        }, 200);

}

function volume_down(playerID){

        adapter.setState(playerID + '.MediaRenderer.RenderingControl.GetVolume.Channel', 'Master');
        adapter.setState(playerID + '.MediaRenderer.RenderingControl.GetVolume.InstanceID', 0);
        adapter.setState(playerID + '.MediaRenderer.RenderingControl.GetVolume', 'send');
        setTimeout(function() {
            adapter.getObject(playerID + '.MediaRenderer.RenderingControl.Volume', function(err, obj){
                    var maxVol = obj.native.maximum;
            adapter.getState(playerID + '.MediaRenderer.RenderingControl.Volume', function (err, state) {
                var oldVol = state.val;
                var volInPercent = maxVol/100;
                var newVol = parseInt(oldVol) - volInPercent * 5; //der Wert um den die Lautstärke geändert wird, kann beliebig geändert werden

                //neue Lautstärke senden
                adapter.setState(playerID + '.MediaRenderer.RenderingControl.SetVolume.Channel', 'Master');
                adapter.setState(playerID + '.MediaRenderer.RenderingControl.SetVolume.DesiredVolume', newVol);
                adapter.setState(playerID + '.MediaRenderer.RenderingControl.SetVolume.InstanceID', 0);
                adapter.setState(playerID + '.MediaRenderer.RenderingControl.SetVolume', 'send');

                setTimeout(function () {
                    adapter.setState(playerID + '.Player.AudioControl.volume_down', false);
                }, 150);
            })
            })
        }, 200);
}

function randomPlay(playerID){

    adapter.setState(playerID + '.MediaRenderer.AVTransport.SetPlayMode.InstanceID', 0);
    adapter.setState(playerID + '.MediaRenderer.AVTransport.SetPlayMode.NewPlayMode', 0);
    adapter.setState(playerID + '.MediaRenderer.AVTransport.SetPlayMode', 'send');
    setTimeout(function(){adapter.setState(playerID + '.Player.MediaControl.randomPlay', false);}, 150);

}

function readPlaylist(path){


    var pattHttp = new RegExp(/^http/g);
    var testHttp = pattHttp.test(path);

    if(testHttp === true){
        request.get(path, function (error, response, body) {
            if (!error && response.statusCode == 200) {
                var pattEXT = new RegExp(/^#EXTM3U/g);
                var testEXT = pattEXT.test(body);

                if(testEXT === true){
                    var list = body.replace('#EXTM3U\n', '');
                    list = list.replace(/#EXTINF:\d*,.*\n/g, '');
                    list = list.replace(/\n$/g, '');
                    playlist = list.split('\n');
                    console.log('EXTM3U: ' + playlist[2]);
                }else {
                    var res = body.split('\n');
                    playlist = res;
                    console.log(res);
                }
            }else{
                adapter.log.error(error);
            }
        });
    }else {
        console.log('local');
        try{path = path.replace(/\\/g, '\\');}catch(err){}
        fs.readFile(path, 'utf8', function (err, data) {
            if (err) throw err;
            var res = data.split("\r");
            playlist = res;
            console.log(playlist);
        });
    }
}

exports.main = main;
exports.getAdapter = getAdapter;
//exports.setAvailablePlayers = setAvailablePlayers;
exports.createPlayerStates = createPlayerStates;