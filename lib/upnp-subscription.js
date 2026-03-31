/*
Copyright (c) 2015 Barry John Williams
https://github.com/bazwilliams/node-upnp-subscription
 */
'use strict';

const http = require('http');
const portfinder = require('portfinder');
const ip = require('neoip');
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
        portfinder.getPort((err, availablePort) => {
            httpSubscriptionResponseServer = http.createServer();
            httpServerPort = availablePort;
            httpSubscriptionResponseServer.listen(httpServerPort, () => {
                httpServerStarted = true;
                httpServerEmitter.emit('started');
                httpServerStarting = false;
                httpSubscriptionResponseServer.on('request', (req, res) => {
                    let sid = req.headers.sid;
                    if (!sid) {
                        res.statusCode = 400;
                        res.end();
                        return;
                    }
                    let handle = xmlResponseParser((err, data) => {
                        let emitter = subscriptions.get(sid);
                        emitter && emitter.emit('message', { sid: sid, body: data });
                    });
                    handle(req, res);
                });
                callback()
            });
            httpSubscriptionResponseServer.on('error', (err) => {
                console.error('HTTP Subscription Server Error: ' + err.message);
            });
        });
    }
};

function Subscription(host, port, eventSub, requestedTimeoutSeconds) {
    let sid,
        resubscribeTimeout,
        emitter = this,
        timeoutSeconds = requestedTimeoutSeconds || 1800,
        isUnsubscribed = false;

    function resubscribe() {
        if (sid && !isUnsubscribed) {
            let req = http.request({
                host: host,
                port: port,
                path: eventSub,
                method: 'SUBSCRIBE',
                headers: {
                    'SID': sid,
                    'TIMEOUT': 'Second-' + timeoutSeconds
                }
            }, res => {
                emitter.emit('resubscribed', { sid: sid });
                resubscribeTimeout = setTimeout(resubscribe, (timeoutSeconds - 1) * 1000)
            });
            
            req.on('error', e => {
                emitter.emit('error:resubscribe', { sid: sid, error: e });
                // If the connection was reset, we might want to try to subscribe again completely
                // but for now, we just log it.
            });
            req.end();
        }
    }
    this.unsubscribe = function unsubscribe() {
        isUnsubscribed = true;
        clearTimeout(resubscribeTimeout);
        if (sid) {
            let req = http.request({
                host: host,
                port: port,
                path: eventSub,
                method: 'UNSUBSCRIBE',
                headers: {
                    'SID': sid
                }
            }, res => emitter.emit('unsubscribed', { sid: sid }));
            
            req.on('error', e => emitter.emit('error:unsubscribe', e));
            req.setTimeout(3000, () => emitter.emit('unsubscribed', { sid: sid }));
            req.end();
        } else {
            emitter.emit('error:unsubscribe', new Error('No SID for subscription'));
        }
        subscriptions.delete(sid);
    }.bind(this);

    this.init = function () {
        let req = http.request({
            host: host,
            port: port,
            path: eventSub,
            method: 'SUBSCRIBE',
            headers: {
                CALLBACK: '<http://' + ip.address() + ':' + httpServerPort + '>',
                NT: 'upnp:event',
                TIMEOUT: 'Second-' + timeoutSeconds
            }
        }, res => {
            sid = res.headers.sid;
            if (!sid) {
                emitter.emit('error', new Error('No SID received from ' + host));
                return;
            }
            emitter.emit('subscribed', { sid: sid });
            if (res.headers.timeout) {
                let subscriptionTimeout = res.headers.timeout.match(/\d+/);
                if (subscriptionTimeout) {
                    timeoutSeconds = parseInt(subscriptionTimeout[0], 10);
                }
            }
            resubscribeTimeout = setTimeout(resubscribe, (timeoutSeconds - 1) * 1000);
            subscriptions.set(sid, emitter);
        });
        
        req.on('error', e => {
            emitter.emit('error', e);
            if (sid) subscriptions.delete(sid);
        });
        req.end();

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