var setTimeout;
var clearTimeout;
var setInterval;
var clearInterval;
var loop;
var wakeup;
var register;
var registerFile;
var console = {log:print};
var nextTick;

(function() {
    // interface
    wakeup = function() {
        sel.wakeup();
    }
    
    registerFile = function(channel,ops,handler) {
        return filesel.register(channel,ops,handler);
    }

    register = function(channel, ops, handler) {
        return channel.register(sel,ops,handler);
    }

    setTimeout = function(cb, delay) {
        timers++;
        var task = TimerTask({run:expireTimer,data:{cb:cb,args:arguments,remove:true}});
        timer.schedule(task,delay);
        return task;
    }

    setInterval = function(cb, period) {
        timers++;
        var task = TimerTask({run:expireTimer,data:{cb:cb,args:arguments}});
        timer.schedule(task,period,period);
        return task;
    }
        
    clearInterval = clearTimeout = function(task) {
        var res = task.cancel();
        if(res) timers--;
        return res;
    };

    nextTick = sync(function(cb) {
        timerCBs.push({cb:cb,args:arguments});
        wakeup();
        },timer);


    // internal from here on
    importPackage(java.nio.channels);
    importPackage(java.util);
    importClass(java.lang.System);

    // Key and FileSelector "simulate" selectable file channels
    function Key(channel, supportedops, selector, attachment) 
    {
        this.filechannel = channel;
        this.attached = attachment;
        this.ops = 0;
        this.cancelled = false;
        this.supportedops = supportedops;
        this.selector = selector;
    }
    Key.prototype = {
        isValid: function() {
            return !this.cancelled;
        },
        isReadable: function() {
            return (this.ops & SelectionKey.OP_READ) !== 0;
        },
        isWritable: function() {
            return (this.ops & SelectionKey.OP_WRITE) !== 0;
        },
        channel: function() {
            return this.filechannel;
        },
        attachment: function() {
            return this.attached;
        },
        readyOps: function() {
            return this.ops;
        },
        interestOps: function(ops) {
            if(typeof ops === "number") {
                if (ops === 0) {
                    this.selector.remove(this);
                } else if (this.ops === 0) {
                    if ((ops | this.supportedops) !== this.supportedops) throw "Unsupported Operation";
                    this.selector.add(this);
                }
                this.ops = ops;
            }
            return this.ops;
        },
        cancel: function() {
            this.selector.remove(this);
            this.cancelled = true;
        },
        close: function() {
            this.filechannel.close();
            this.cancel();
        }
    };

    function FileSelector() {}
    FileSelector.prototype = {
        register: function(channel,ops,handler) {
            if (!channel.isOpen()) throw "Channel is closed";
            return new Key(channel, ops, this, handler);
        },
        add: function(key) {
            files.push(key);
            wakeup();
        },
        remove: function(key) {
            var i = files.indexOf(key);
            if(i>=0) files.splice(i,1);
        },
    }

    var sel = Selector.open(); 
    var filesel = new FileSelector();

    var files = [];

    // we use a Java Timer here
    // this is in a different thread
    // so access to timerCB needs to be synchronized
    var timer = new Timer("rhinode timers",true);
    var timerCBs = [];
    var timers = 0;

    var expireTimer = sync(function() {
        // expired timer do not actually run the callback
        // but place it in a queue to be picked up by the main loop
        timerCBs.push(this.data);
        wakeup();
        },timer);

    // move to Java?
    var handleTimers = sync(function() {
        for each (var timer in timerCBs) {
            timer.cb(Array.prototype.slice.call(timer.args,2));
            if (timer.remove) timers--;
        }
        timerCBs = [];
        },timer);

    function handleFiles() {
        for each (var key in files) {
            if (key.isValid()) {
                var handler = key.attachment();
                if (key.isReadable()) {
                    handler.onRead(key);
                } else if (key.isWritable()) {
                    handler.onWrite(key);
                }
            }
        }
        if (files.length>0) wakeup();
    }

    var LOW_RES = 1000; // resolution for low-res timers (i.e. socket idle checks)
    var nextIdleCheck = 0;

    // move to Java?
    function handleIdleSockets(keys) {
        var t = System.currentTimeMillis();
        if (nextIdleCheck <= t && !keys.isEmpty()) {
            var i = keys.iterator();
            while(i.hasNext()) {
                i.next().attachment().onCheckTimeout(t);
            }
            nextIdleCheck = t + LOW_RES;
        }
    }

    // moce to Java?
    function handleSockets(keys) {
        var i = keys.iterator();
        while(i.hasNext()) {
            var key = i.next();
            if (key.isValid()) {
                var handler = key.attachment();
                if (key.isReadable()) {
                    handler.onRead(key);
                } else if (key.isWritable()) {
                    handler.onWrite(key);
                } else if (key.isAcceptable()) {
                    handler.onAccept(key);
                } else if (key.isConnectable()) {
                    handler.onConnect(key);
                }
            }
        }
        keys.clear();
    }

    /*
     * Main event loop. Rhinode will enter this loop automatically.
     * ...move to Java?
     */
    loop = function() {
        while (!sel.keys().isEmpty() || timers > 0 || files.length > 0) {
            sel.select(LOW_RES);
            handleIdleSockets(sel.keys());
            handleSockets(sel.selectedKeys());
            handleFiles();
            handleTimers();
        }
    };
})();
