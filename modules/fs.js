var event = require('event');
importPackage(org.rhinode);
importPackage(java.nio);

// Java NIO does not provide a selectable FileChannel.
// FileChannels are always considered to be readable and writable.

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
    this.key.interestOps(this.key.interestOps() & ~SelectionKey.OP_READ);
}

ReadStream.prototype.resume = function() {
    this.key.interestOps(this.key.interestOps() | SelectionKey.OP_READ);
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
    this.key.interestOps(this.key.interestOps() & ~SelectionKey.OP_WRITE);
}

WriteStream.prototype.resume = function() {
    this.key.interestOps(this.key.interestOps() | SelectionKey.OP_WRITE);
};

WriteStream.prototype.write = function(data,enc) {
    if (enc)
        this.writeBuffer.write(data,enc);
    else
        this.writeBuffer.write(data);

    if (this.writeBuffer.writeTo(this.key.channel()) == 0)
        return true;

    // couldn't write the entire buffer, try again when the socket is ready for writing
    this.key.interestOps(SelectionKey.OP_WRITE);
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

// Don't use this with big files :)
function readFileSync(path, enc) {
    var channel = new java.io.FileInputStream(path).getChannel();
    var out = ByteBuffer.allocate(channel.size());
    while(channel.read(out) > 0);
    out.flip();
    if (enc) {
        print(enc);
        var decoder = java.nio.charset.Charset.forName(enc).newDecoder();
        var cout = CharBuffer.allocate(out.remaining()*decoder.maxCharsPerByte());
        decoder.decode(out,cout,true);
        return cout.flip().toString();
    }
    return out;
}

function createReadStream(path) {
    var channel = new java.io.FileInputStream(path).getChannel();
    var myHandler = Object.create(handler);
    var key = registerFile(channel, SelectionKey.OP_READ, myHandler);
    myHandler.readStream = new ReadStream(key);
    return myHandler.readStream;
}

function createWriteStream(path) {
    var channel = new java.io.FileOutputStream(path).getChannel();
    var myHandler = Object.create(handler);
    var key = registerFile(channel, SelectionKey.OP_WRITE, myHandler);
    myHandler.writeStream = new WriteStream(key);
    return myHandler.writeStream;
}

exports.createReadStream = createReadStream;
exports.createWriteStream = createWriteStream;
exports.copyStream = copyStream;
exports.readFileSync = readFileSync;