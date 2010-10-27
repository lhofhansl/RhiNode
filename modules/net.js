// net module
// Basically a wrapper around NIO, hence the many calls to Java NIO methods.
// The write buffer/queue protocol still needs to be worked out.
// This uses the event model without shortcut and can be optimized by doing direct
// function calls.
var event = require('event');
importPackage(org.rhinode);

var STATES = {
    closed: 0,
    readOnly: 1,
    writeOnly: 2,
    open: 3, // readOnly | writeOnly
    connecting: 4
};
var STATE_NAMES = ["closed","readOnly","writeOnly","open","connecting"];

var readPool = new BytePool();

function Socket(key,state) {
    this._writeBuffer = new ByteBufferOutputStream(128,256*1024);
    this._key = key;
    this._state = state || STATES.closed;
    this.setTimeout(120000);
    this.on("timeout",this.close);
}

Socket.prototype = new event.Listener();

// Coarse timeout (1sec precision)
Socket.prototype.setTimeout = function(msecs) {
    if (msecs === 0) {
        delete this.timeout;
        delete this._timeout;
    } else {
        this.timeout = msecs;
        this._timeout = System.currentTimeMillis() + msecs;
    }
}

// connect a client socket
Socket.prototype.connect = function(port, host, cb) {
    if (this._state !== STATES.closed) {
        this.fire("error","socket must be closed");
        return null;
    }

    var sc = SocketChannel.open();
    sc.configureBlocking(false);
    var res = sc.connect(new java.net.InetSocketAddress(host||"127.0.0.1", port));
    var myHandler = Object.create(handler,{socket:{value:this}});
    this._key = register(sc, res ? SelectionKey.OP_READ : SelectionKey.OP_CONNECT, myHandler);
    this._state = res ? STATES.open : STATES.connecting;
    if (cb) this.on("connect", cb);
    return this;
}

Socket.prototype.__defineGetter__("readyState",function() {return STATE_NAMES[this._state];});

// Main write function
// The caller can request an encodin and/or buffering
Socket.prototype.write = function(data,enc,buffer) {
    if (enc)
        this._writeBuffer.write(data,enc);
    else
        this._writeBuffer.write(data);

    if (!buffer && (this._state & STATES.writeOnly) !== 0 /* && (this._key.interestOps() & SelectionKey.OP_WRITE) === 0 */) {
        if (this.timeout) this._timeout = System.currentTimeMillis() + this.timeout;
        // buffering was not requested, attempt to write to the socket
        if (this._writeBuffer.writeTo(this._key.channel()) == 0)
            return true;
        // couldn't write the entire buffer, try again when the socket is ready for writing
        this._key.interestOps(SelectionKey.OP_WRITE);
    } 
    return false;
}

Socket.prototype.pause = function() {
    if (this._state & STATES.readOnly)
        this._key.interestOps(this._key.interestOps() & ~SelectionKey.OP_READ);
}

Socket.prototype.resume = function() {
    if (this._state & STATES.readOnly)
    this._key.interestOps(this._key.interestOps() | SelectionKey.OP_READ);
};

Socket.prototype.close = function() {
    if (this._state === STATES.closed) return;

    this._key.channel().close();
    this._state = STATES.closed;
    this._key.attach(null);
    delete this._key;

    wakeup();
};

Socket.prototype.end = function() {
    if (this._state === STATES.closed) return;

    if (this._writeBuffer.size() > 0) {
        // if the buffer still has something to write just record that end was requested
        this._endRequested = true;
    } else if(this._state === STATES.writeOnly) {
        this.close();
    } else if(this._state !== STATES.readOnly) {
        try { this._key.channel().socket().shutdownOutput(); } catch (x) {print(x);}
        this._state = STATES.readOnly;
    }
};

Socket.prototype.setEncoding = function(enc) {
    this._decoder = new StatefulDecoder(enc);
};

// This hander is passed to the main event loop
// candicate to move to Java
var handler = {
    onConnect: function(key) {
        try {
            if(key.channel().finishConnect()) {
                this.socket._state = STATES.open;
                if (this.socket._writeBuffer.size() > 0)
                    key.interestOps(SelectionKey.OP_WRITE);
                else
                    key.interestOps(SelectionKey.OP_READ);
                this.socket.fire("connect",this.socket);
            }
        } catch(ex) {
            this.socket.fire("error",ex);
            this.socket.close();
        }
    },
    onAccept: function(key) {
        var sc = key.channel().accept();
        sc.configureBlocking(false);
        //sc.socket().setTcpNoDelay(true);
        var myHandler = Object.create(this); // clone the handler
        var sk = register(sc,SelectionKey.OP_READ,myHandler);
        myHandler.socket = new Socket(sk,STATES.open);
        this.server.fire("connection", myHandler.socket);
        //myHandler.onRead(sk);
    },
    onRead: function(key) {
        var socket = this.socket;
        var data = readPool.readFrom(key.channel());
        if(data) {
            if (socket.timeout) socket._timeout = System.currentTimeMillis() + socket.timeout;
            socket.fire("data", socket._decoder ? socket._decoder.decode(data) : data);
        } else {
            socket._state = STATES.writeOnly;
            socket.fire("end");
            socket.pause();
        }
    },
    onWrite: function(key) {
        var socket = this.socket;
        if (socket._writeBuffer.writeTo(key.channel()) == 0) {
            // the buffer was written to the socket completely so switch back to read
            key.interestOps(SelectionKey.OP_READ);
            if (socket._endRequested) {
                socket.end();
            } else {
                socket.fire("drain");
            }
        }
    },
    onCheckTimeout: function(t) {
        if(this.socket && this.socket._timeout < t)
            this.socket.fire("timeout");
    }
};

function Server(cb) {
    if (cb) this.on("connection",cb);    
}

Server.prototype = new event.Listener();

Server.prototype.listen = function(port, host, queue) {
    queue = queue || 128;
    this.ssc = java.nio.channels.ServerSocketChannel.open();
    //this.ssc.socket().setReuseAddress(true);
    //this.ssc.socket().setReceiveBufferSize(1<<17);
    this.ssc.configureBlocking(false);
    if(host)
        this.ssc.socket().bind(new java.net.InetSocketAddress(host,port), queue);
    else
        this.ssc.socket().bind(new java.net.InetSocketAddress(port), queue);
    var myHandler = Object.create(handler,{server:{value:this}});
    register(this.ssc, SelectionKey.OP_ACCEPT,myHandler);
}

Server.prototype.close = function() {
    this.ssc.close();
    wakeup();
}

Server.prototype.setSecure = function(creds) {
    // TODO
}

function createConnection(port, host, cb) {
    return new Socket().connect(port,host,cb);
}

function createServer(cb) {
    var server = new Server(cb);
    return server;
}

exports.createServer = createServer;
exports.createConnection = createConnection;
exports.Server = Server;
exports.Socket = Socket;