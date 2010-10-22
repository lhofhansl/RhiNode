var event = require('event');
importPackage(org.rhinode);

// Simulate selectable files. Java NIO does not provide a selectable FileChannel.
// Basically FileChannels are always considered to be readable and writable.
// Just implement enough of the SelectionKey interface for our usage.

var OP_READ = 1;
var OP_WRITE = 2;

function Key(channel, ops, supportedops, attachment) 
{
    this.filechannel = channel;
    this.attached = attachment;
    this.ops = ops;
    this.cancelled = false;
    this.supportedops = supportedops;
}
Key.prototype.isValid = function() {
    return !this.cancelled;
}
Key.prototype.isReadable = function() {
    return (this.ops & OP_READ) !== 0;
}
Key.prototype.isWritable = function() {
    return (this.ops & OP_WRITE) !== 0;
}
Key.prototype.channel = function() {
    return this.filechannel;
}
Key.prototype.attachment = function() {
    return this.attached;
}
Key.prototype.readyOps = function() {
    return this.ops;
}
Key.prototype.interestOps = function(ops) {
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
}
Key.prototype.cancel = function() {
    this.selector.remove(this);
    this.cancelled = true;
}
Key.prototype.close = function() {
    this.filechannel.close();
    this.cancel();
}

//// Stream ////

var readPool = new BytePool();

function ReadStream(key) {
    this.key = key;
}

ReadStream.prototype = new event.Listener();

ReadStream.prototype.addEventListener = function(ev, listener) {
    event.Listener.prototype.addEventListener.call(this,ev,listener);
    if (this.has('data'))
        this.resume();
}

ReadStream.prototype.removeEventListener = function(ev) {
    event.Listener.prototype.removeEventListener.call(this,ev);
    if (!this.has('data'))
        this.pause();    
}
ReadStream.prototype.on = ReadStream.prototype.addEventListener;

ReadStream.prototype.pause = function() {
    this.key.interestOps(this.key.interestOps() & ~OP_READ);
}

ReadStream.prototype.resume = function() {
    this.key.interestOps(this.key.interestOps() | OP_READ);
};

ReadStream.prototype.close = function() {
    this.key.close();
    this.key.attach(null);
    delete this.key;

    wakeup();
};
ReadStream.prototype.setEncoding = function(enc) {
    this.decoder = new StatefulDecoder(enc);
};

function WriteStream(key) {
    this.writeBuffer = new ByteBufferOutputStream(128,256*1024);
    this.key = key;
}

WriteStream.prototype.pause = function() {
    this.key.interestOps(this.key.interestOps() & ~OP_WRITE);
}

WriteStream.prototype.resume = function() {
    this.key.interestOps(this.key.interestOps() | OP_WRITE);
};

WriteStream.prototype.write = function(data,enc) {
    if (enc)
        this.writeBuffer.write(data,enc);
    else
        this.writeBuffer.write(data);

    if (this.writeBuffer.writeTo(this.key.channel()) == 0)
        return true;

    // couldn't write the entire buffer, try again when the socket is ready for writing
    this.key.interestOps(OP_WRITE);
    return false;
}


WriteStream.prototype.end = function() {
    if (this.writeBuffer.size() > 0) {
        // can this even happen?
        this._endRequested = true;
    } else {
        this.key.close();
    }
}

var handler = {
    onRead: function(key) {
        var stream = this.readStream;
        var data = readPool.readFrom(key.channel());
        if(data) {
            stream.fire("data", stream.decoder ? stream.decoder.decode(data) : data);
        } else {
            stream.fire("close");
            stream.fire("end");
            key.close();
        }
    },
    onWrite: function(key) {
        var stream = this.writeStream;
        if (stream.writeBuffer.writeTo(key.channel()) == 0) {
            // the buffer was written to the socket completely
            stream.resume();
            if (stream._endRequested) {
                stream.end();
            } else {
                stream.fire("drain");
            }
        }
    }
}

// idea from node.js
function copyStream(readStream, writeStream) {
    readStream.on("data", function (data) {
            if (writeStream.write(data) === false) readStream.pause();
        });

    writeStream.on("pause", function () {
            readStream.pause();
        });

    writeStream.on("drain", function () {
            readStream.resume();
        });

    writeStream.on("resume", function () {
            readStream.resume();
        });

    readStream.on("end", function () {
            writeStream.end();
        });
};

function createReadStream(path) {
    var channel = new java.io.FileInputStream(path).getChannel();
    var myHandler = Object.create(handler);
    var key = new Key(channel, 0, OP_READ, myHandler);
    registerFile(key);
    myHandler.readStream = new ReadStream(key);
    return myHandler.readStream;
}

function createWriteStream(path) {
    var channel = new java.io.FileOutputStream(path).getChannel();
    var myHandler = Object.create(handler);
    var key = new Key(channel, 0, OP_WRITE, myHandler);
    registerFile(key);
    myHandler.writeStream = new WriteStream(key);
    return myHandler.writeStream;
}

exports.createReadStream = createReadStream;
exports.createWriteStream = createWriteStream;
exports.copyStream = copyStream;
exports.OP_READ = OP_READ;
exports.OP_WRITE = OP_WRITE;
