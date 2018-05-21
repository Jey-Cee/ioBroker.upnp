/*
Copyright (c) 2015 Barry John Williams
https://github.com/bazwilliams/node-upnp-subscription
 */
"use strict";

const http = require('http');
const portfinder = require('portfinder');
const ip = require('ip');
const util = require('util');
const events = require('events');
const xmlResponseParser = require('parsexmlresponse');

let httpServerEmitter = new events();
httpServerEmitter.setMaxListeners(100);

let httpServerStarting = false;
let httpServerStarted = false;
let httpServerPort;
let httpSubscriptionResponseServer;

let subscriptions = new Map();

let ensureHttpServer = function (callback) {
    if (httpServerStarting) {
        httpServerEmitter.once('started', callback)
    } else {
        httpServerStarting = true;
        portfinder.getPort(function (err, availablePort) {
            httpSubscriptionResponseServer = http.createServer();
            httpServerPort = availablePort;
            httpSubscriptionResponseServer.listen(httpServerPort, () => {
                httpServerStarted = true;
                httpServerEmitter.emit('started');
                httpServerStarting = false;
                httpSubscriptionResponseServer.on('request', (req, res) => {
                    let sid = req.headers.sid;
                    let handle = xmlResponseParser((err, data) => {
                        let emitter = subscriptions.get(sid);
                        if (emitter) {
                            emitter.emit('message', { sid: sid, body: data });
                        }
                    });
                    handle(req, res);
                });
                callback()
            });
        });
    }
};

function Subscription(host, port, eventSub, requestedTimeoutSeconds) {
    let sid,
        resubscribeTimeout,
        emitter = this,
        timeoutSeconds = requestedTimeoutSeconds || 1800;

    function resubscribe() {
        if (sid) {
            var req = http.request({
                host: host,
                port: port,
                path: eventSub,
                method: 'SUBSCRIBE',
                headers: {
                    'SID': sid,
                    'TIMEOUT': 'Second-' + timeoutSeconds
                }
            }, function(res) {
                emitter.emit('resubscribed', { sid: sid });
                resubscribeTimeout = setTimeout(resubscribe, (timeoutSeconds-1) * 1000)
            }).on('error', function (e) {
                emitter.emit('error:resubscribe', { sid: sid, error: e });
            }).end();
        }
    }
    this.unsubscribe = function unsubscribe() {
        clearTimeout(resubscribeTimeout);
        if (sid) {
            http.request({
                host: host,
                port: port,
                path: eventSub,
                method: 'UNSUBSCRIBE',
                headers: {
                    'SID': sid
                }
            }, function(res) {
                emitter.emit('unsubscribed', { sid: sid });
            }).on('error', function(e) {
                emitter.emit('error:unsubscribe', e);
            }).setTimeout(3000, () => emitter.emit('unsubscribed', { sid: sid })).end();
        } else {
            emitter.emit('error:unsubscribe', new Error('No SID for subscription'));
        }
        subscriptions.delete(sid);
    }.bind(this);

    this.init = function () {
        http.request({
            host: host,
            port: port,
            path: eventSub,
            method: 'SUBSCRIBE',
            headers: {
                'CALLBACK': "<http://" + ip.address() + ':' + httpServerPort + ">",
                'NT': 'upnp:event',
                'TIMEOUT': 'Second-' + timeoutSeconds
            }
        }, function(res) {
            emitter.emit('subscribed', { sid: res.headers.sid });
            sid = res.headers.sid;
            if (res.headers.timeout) {
                let subscriptionTimeout = res.headers.timeout.match(/\d+/);
                if (subscriptionTimeout) {
                    timeoutSeconds = subscriptionTimeout[0];
                }
            }
            resubscribeTimeout = setTimeout(resubscribe, (timeoutSeconds-1) * 1000);
            subscriptions.set(sid, emitter);
        }).on('error', function(e) {
            emitter.emit('error', e);
            subscriptions.delete(sid);
        }).end();
        events.EventEmitter.call(this);
    }.bind(this);

    if (!httpServerStarted) {
        ensureHttpServer(this.init)
    } else {
        this.init()
    }
}
util.inherits(Subscription, events.EventEmitter);
module.exports = Subscription;