/**
 * Created by Jey Cee on 30.06.2017.
 */
'use strict';

const fs = require('fs');
const request = require('request');

let adapter;

function getAdapter(_adapter) {
    adapter = _adapter;
}
let addTask;
let processTasks;

function registerTasksHandler(_addTask, _processTasks) {
    addTask = _addTask;
    processTasks = _processTasks;
}

function createPlayerStates() {
    let arrMedia = ['play', 'pause', 'stop'];
    let arrAudio = ['volume_up', 'volume_down', 'mute'];
    let varDevice = '';

    adapter.getStatesOf('upnp.' + adapter.instance, (err, _states) => {
        let statesLength = _states.length;

        for (let x = statesLength - 1; x >= 0; x--) {
            if (!JSON.stringify(_states[x]['_id']).match(/\.MediaRenderer.Alive/g)) {
                //if the match deliver null nothing is to do
            } else {
                varDevice = _states[x]['_id'];
                varDevice = varDevice.replace('.MediaRenderer.Alive', '');

                arrAudio.forEach(item => {
                    addTask({
                        name: 'setObjectNotExists',
                        id: varDevice + '.Player.AudioControl.' + item,
                        obj: {
                            type: 'state',
                            common: {
                                name: item,
                                type: 'boolean',
                                read: true,
                                write: true,
                                role: 'media.' + item
                            },
                            native: {}
                        }
                    });
                });

                arrMedia.forEach(item => {
                    addTask({
                        name: 'setObjectNotExists',
                        id: varDevice + '.Player.MediaControl.' + item,
                        obj: {
                            type: 'state',
                            common: {
                                name: item,
                                type: 'boolean',
                                read: true,
                                write: true,
                                role: 'media.' + item
                            },
                            native: {}
                        }
                    });
                });

                addTask({
                    name: 'setObjectNotExists',
                    id: varDevice + '.Player.MediaControl.mediaURL',
                    obj: {
                        type: 'state',
                        common: {
                            name: 'mediaURL',
                            type: 'string',
                            read: true,
                            write: true,
                            role: 'media.input'
                        },
                        native: {}
                    }
                });

                addTask({
                    name: 'setObjectNotExists',
                    id: varDevice + '.Player.MediaControl.randomPlay',
                    obj: {
                        type: 'state',
                        common: {
                            name: 'randomPlay',
                            type: 'string',
                            read: true,
                            write: true,
                            role: 'media.random'
                        },
                        native: {}
                    }
                });
            }
        } //END for

        processTasks();
    }); //END adapter.getStatesOf()
}

let track;
let playlist;

function main(id, state) {
    //console.log('state: ' + JSON.stringify(id) + ' ' + JSON.stringify(state));
    let value = state.val;

    //get control command
    if (value === true) {
        const patt = new RegExp(/.*\./g);
        id = id.toString();
        let control = id.replace(patt, '');
        const patt2 = new RegExp(/\.Player\..*\..*/g);
        let playerID = id.replace(patt2, '');
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
    } else if (value !== '' || value !== null) {
        adapter.log.debug('if value != 0');
        const pattURL = new RegExp(/\.mediaURL/g);
        id = id.toString();
        let testURL = pattURL.test(id);

        if (testURL === true) {
            console.log('if testURL === true');
            const pattMP3 = new RegExp(/\.mp3$/g);
            let testMP3 = pattMP3.test(value);

            if (testMP3 === true) {
                track = value;
            }

            const pattM3U = new RegExp(/\.m3u$/g);
            let testM3U = pattM3U.test(value);

            if (testM3U === true) {
                console.log('if testM3U === true');
                readPlaylist(value);
            }
        }
    }
}

//control functions
function play(playerID) {


    //if(track !== '' && track !== null && track !== undefined) {
    /*adapter.log.info('single track');
    addTask({name: 'setState', id: playerID + '.MediaRenderer.AVTransport.SetAVTransportURI.InstanceID', state: 0});
    addTask({name: 'setState', id: playerID + '.MediaRenderer.AVTransport.SetAVTransportURI.CurrentURI', state: track});
    addTask({name: 'setState', id: playerID + '.MediaRenderer.AVTransport.SetAVTransportURI', state: 'send'});*/

    setTimeout(() => {
        addTask({name: 'setState', id: playerID + '.MediaRenderer.AVTransport.Play.InstanceID', state: 0});
        addTask({name: 'setState', id: playerID + '.MediaRenderer.AVTransport.Play.Speed', state: 1});
        addTask({name: 'setState', id: playerID + '.MediaRenderer.AVTransport.Play', state: 'send'});
        processTasks();
    }, 15);
    /*}else if(playlist !== '' && playlist !== null && playlist !== undefined){
            adapter.log.info('playlist');
            var player = new PlayPlaylist('value');
            player.play(playlist);
            setTimeout(function(){
                playlist = '';
            }, 10);
    }*/


    setTimeout(() => {
        addTask({name: 'setState', id: playerID + '.Player.MediaControl.play',     state: false});
        addTask({name: 'setState', id: playerID + '.Player.MediaControl.mediaURL', state: ''});
        processTasks();
        track = '';
    }, 150);

}

function PlayPlaylist(name) {
    this.name = name;
}

PlayPlaylist.prototype = {
    play: list => {
        let noOfTracks = list.length;
        console.log('Tracks in Playlist: ' + noOfTracks);

        (function myLoop(i) {
            setTimeout(() => {
                console.log('Track Number: ' + i);
                if (--i) myLoop(i);      //  decrement i and call myLoop again if i > 0
            }, 1000)
        })(noOfTracks - 1);

    }
};

function pause(playerID) {
    addTask({name: 'setState', id: playerID + '.MediaRenderer.AVTransport.Pause.InstanceID', state: 0});
    addTask({name: 'setState', id: playerID + '.MediaRenderer.AVTransport.Pause', state: 'send'});
    processTasks();
    setTimeout(() => {
        addTask({name: 'setState', id: playerID + '.Player.MediaControl.pause', state: false});
        processTasks();
    }, 150);

}

function stop(playerID) {
    addTask({name: 'setState', id: playerID + '.MediaRenderer.AVTransport.Stop.InstanceID', state: 0});
    addTask({name: 'setState', id: playerID + '.MediaRenderer.AVTransport.Stop', state: 'send'});
    processTasks();

    setTimeout(() => {
        addTask({name: 'setState', id: playerID + '.Player.MediaControl.stop', state: false});
        processTasks();
    }, 150);
}

function mute(playerID) {
    addTask({name: 'setState', id: playerID + '.MediaRenderer.RenderingControl.GetMute.Channel', state: 'Master'});
    addTask({name: 'setState', id: playerID + '.MediaRenderer.RenderingControl.GetMute.InstnaceID', state: 0});
    addTask({name: 'setState', id: playerID + '.MediaRenderer.RenderingControl.GetMute', state: 'send'});
    processTasks();
    setTimeout(() => {
        adapter.getState(playerID + '.MediaRenderer.RenderingControl.Mute', (err, state) => {
            let oldMute = parseFloat(state.val);
            console.log('oldMute: ' + oldMute);
            if (!oldMute) {
                addTask({name: 'setState', id: playerID + '.MediaRenderer.RenderingControl.SetMute.InstanceID', state: 0});
                addTask({name: 'setState', id: playerID + '.MediaRenderer.RenderingControl.SetMute.Channel', state: 'Master'});
                addTask({name: 'setState', id: playerID + '.MediaRenderer.RenderingControl.SetMute.DesiredMute', state: 1});
                addTask({name: 'setState', id: playerID + '.MediaRenderer.RenderingControl.SetMute', state: 'send'});
            } else {
                addTask({name: 'setState', id: playerID + '.MediaRenderer.RenderingControl.SetMute.InstanceID', state: 0});
                addTask({name: 'setState', id: playerID + '.MediaRenderer.RenderingControl.SetMute.Channel', state: 'Master'});
                addTask({name: 'setState', id: playerID + '.MediaRenderer.RenderingControl.SetMute.DesiredMute', state: 0});
                addTask({name: 'setState', id: playerID + '.MediaRenderer.RenderingControl.SetMute', state: 'send'});
            }
            processTasks();
            setTimeout(() => {
                addTask({name: 'setState', id: playerID + '.Player.AudioControl.mute', state: false});
                processTasks();
            }, 150);
        })
    }, 200);

}

function volume_up(playerID) {

    addTask({name: 'setState', id: playerID + '.MediaRenderer.RenderingControl.GetVolume.Channel', state: 'Master'});
    addTask({name: 'setState', id: playerID + '.MediaRenderer.RenderingControl.GetVolume.InstanceID', state: 0});
    addTask({name: 'setState', id: playerID + '.MediaRenderer.RenderingControl.GetVolume', state: 'send'});
    processTasks();
    setTimeout(() => {
        adapter.getObject(playerID + '.MediaRenderer.RenderingControl.Volume', (err, obj) => {
            let maxVol = obj.native.maximum;
            adapter.getState(playerID + '.MediaRenderer.RenderingControl.Volume', (err, state) => {
                let oldVol = state.val;
                let volInPercent = maxVol / 100;
                let newVol = parseInt(oldVol) + volInPercent * 5; //der Wert um den die Lautstärke geändert wird, kann beliebig geändert werden

                // neue Lautstärke senden
                addTask({name: 'setState', id: playerID + '.MediaRenderer.RenderingControl.SetVolume.Channel', state: 'Master'});
                addTask({name: 'setState', id: playerID + '.MediaRenderer.RenderingControl.SetVolume.DesiredVolume', state: newVol});
                addTask({name: 'setState', id: playerID + '.MediaRenderer.RenderingControl.SetVolume.InstanceID', state: 0});
                addTask({name: 'setState', id: playerID + '.MediaRenderer.RenderingControl.SetVolume', state: 'send'});
                processTasks();
                setTimeout(() => {
                    addTask({name: 'setState', id: playerID + '.Player.AudioControl.volume_up', state: false});
                    processTasks();
                }, 150);
            });
        });
    }, 200);
}

function volume_down(playerID) {

    addTask({name: 'setState', id: playerID + '.MediaRenderer.RenderingControl.GetVolume.Channel', state: 'Master'});
    addTask({name: 'setState', id: playerID + '.MediaRenderer.RenderingControl.GetVolume.InstanceID', state: 0});
    addTask({name: 'setState', id: playerID + '.MediaRenderer.RenderingControl.GetVolume', state: 'send'});
    processTasks();
    setTimeout(() => {
        adapter.getObject(playerID + '.MediaRenderer.RenderingControl.Volume', (err, obj) => {
            let maxVol = obj.native.maximum;
            adapter.getState(playerID + '.MediaRenderer.RenderingControl.Volume', (err, state) => {
                let oldVol = state.val;
                let volInPercent = maxVol / 100;
                let newVol = parseInt(oldVol) - volInPercent * 5; //der Wert um den die Lautstärke geändert wird, kann beliebig geändert werden

                //neue Lautstärke senden
                addTask({name: 'setState', id: playerID + '.MediaRenderer.RenderingControl.SetVolume.Channel', state: 'Master'});
                addTask({name: 'setState', id: playerID + '.MediaRenderer.RenderingControl.SetVolume.DesiredVolume', state: newVol});
                addTask({name: 'setState', id: playerID + '.MediaRenderer.RenderingControl.SetVolume.InstanceID', state: 0});
                addTask({name: 'setState', id: playerID + '.MediaRenderer.RenderingControl.SetVolume', state: 'send'});
                processTasks();
                setTimeout(() => {
                    addTask({name: 'setState', id: playerID + '.Player.AudioControl.volume_down', state: false});
                    processTasks();
                }, 150);
            });
        });
    }, 200);
}

function randomPlay(playerID) {
    addTask({name: 'setState', id: playerID + '.MediaRenderer.AVTransport.SetPlayMode.InstanceID', state: 0});
    addTask({name: 'setState', id: playerID + '.MediaRenderer.AVTransport.SetPlayMode.NewPlayMode', state: 0});
    addTask({name: 'setState', id: playerID + '.MediaRenderer.AVTransport.SetPlayMode', state: 'send'});
    processTasks();
    setTimeout(() => {
        addTask({name: 'setState', id: playerID + '.Player.MediaControl.randomPlay', state: false});
        processTasks();
    }, 150);
}

function readPlaylist(path) {
    if (path.match(/^http/g)) {
        request.get(path, (error, response, body) => {
            if (!error && response.statusCode === 200) {
                const pattEXT = new RegExp(/^#EXTM3U/g);
                let testEXT = pattEXT.test(body);

                if (testEXT === true) {
                    let list = body.replace('#EXTM3U\n', '');
                    list = list.replace(/#EXTINF:\d*,.*\n/g, '');
                    list = list.replace(/\n$/g, '');
                    playlist = list.split('\n');
                    console.log('EXTM3U: ' + playlist[2]);
                } else {
                    let res = body.split('\n');
                    playlist = res;
                    console.log(res);
                }
            } else {
                adapter.log.error(error);
            }
        });
    } else {
        console.log('local');
        try {
            path = path.replace(/\//g, '\\');
        } catch (err) {
        }
        fs.readFile(path, 'utf8', (err, data) => {
            if (err) throw err;
            playlist = data.split('\r');
            console.log(playlist);
        });
    }
}

module.exports = {
    main,
    getAdapter,
    createPlayerStates,
    registerTasksHandler,
    // setAvailablePlayers
};
