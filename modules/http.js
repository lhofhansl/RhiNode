// http module
// This is currently implemented as a pure client of the net module API
// and can be optimized a lot by using shortcuts in the net module (or even lower).
importPackage(org.rhinode);

var net = require('net');
var event = require('event');

// this is pretty strict (\s* is much slower that _)
var requestRegex = /^(GET|POST|HEAD|PUT|OPTIONS|DELETE|TRACE) (\S+) HTTP\/(1\.[10])$/;
var responseRegex = /^HTTP\/(1\.[10]) (\d+) (.*)$/;

// using regex/i is slightly faster than
// (1) comparing with .toLowerCase
// (2) java.lang.String.equalsIgnoreCase
var connectionRegex = /connection/i;
var contentLengthRegex = /content-length/i;
var transferEncodingRegex = /transfer-encoding/i;
var chunkedRegex = /chunked/i;
var keepAliveRegex = /keep-alive/i;
var closeRegex = /close/i;

var Headers = {
    100 : 'Continue',
    200 : 'OK',
    201 : 'Created',
    204 : 'No Content',
    404 : 'Not Found',
    405 : 'Method Not Allowed',
    500 : 'Internal Server Error'
    // much more
};

// some constants
var CRLF = new java.lang.String("\r\n").getBytes("US-ASCII");
var jsCRLF = "\r\n";
var LASTCHUNK = new java.lang.String("0\r\n\r\n").getBytes("US-ASCII");

function HttpReader(socket) {
    this.connection = socket;
}

HttpReader.prototype = new event.Listener();

HttpReader.prototype.isKeepAlive = function() {
    return this.httpVersion == "1.1" || keepAliveRegex.test(this.headers.connection);
}

HttpReader.prototype.isChunked = function() {
    return chunkedRegex.test(this.headers["transfer-encoding"]);
}

HttpReader.prototype.hasBody = function() {
    // null in case of client response
    return !this.method || this.method == "POST" || this.method == "PUT";
}

HttpReader.prototype.setEncoding = function(enc) {
    this.enc = enc;
}

//
// HTTP state "machine"
// The actual state is kept in a JavaScript generator that is pumped with the data as it is received from the network.
//
// It yields false when more data from the network is required to continue... True when a request is done.
//
// The only optimization used is HttpScanner, which moves tight loops (like looking for CRLF in a buffer) to Java.
// Generators are somewhat slow to create in Rhino, so it really benefits from HTTP/1.1
// (Or maybe one should pre-create a few of them for reuse in non-keep-alive scenarios)
//
// This can probably be made a bit nicer (using trampolines, etc).
//
function parseState(connector,socket) {
    while(true) {
    var b = yield false;
    var scanner = new HttpScanner();
    var r = new HttpReader(socket);
    var line,request;
    // get the request line
    while((line = scanner.getNextLine(b)) == null) b = yield false;
    if (connector.isServer) {
        request = requestRegex.exec(line);
        if (request == null) {
            socket.close();
            continue;
        }
        r.method = request[1];
        r.url = request[2];
        r.httpVersion = request[3];
    } else {
        request = responseRegex.exec(line);
        if (request == null) {
            connector.fire("error","invalid response");
            continue;
        }
        r.httpVersion = request[1];
        r.statusCode = request[2];
        r.message = request[3];
    }
    // read the headers
    while((r.headers = scanner.getHeaders(b)) == null) b = yield false;
    if (connector.isServer) { 
        let writer = new HttpWriter(r.method,r.url,null,r.httpVersion,socket,r);
        // hacky. Make this nicer. Needed to pass on 'drain' events from the socket
        socket.currentWriter = writer;
        connector.fire("request",r,writer);
    } else {
        r.client = connector.client;
        connector.fire("response",r);
    }

    if (r.hasBody()) {
        let len, data, size;
        if (r.enc) scanner.setEncoding(r.enc);
        if (r.isChunked()) {
            let chunksize;
            do {
                // get the chunk size
                while((line = scanner.getNextLine(b)) == null) b = yield false;
                chunksize = parseInt(line,16) || 0;
                len = chunksize;
                // now consume the chunk
                while(len > 0) {
                    [size,data] = scanner.getContent(b,len);
                    if (size > 0) {
                        r.fire("data", data);
                        len -= size;
                    }
                    if (len > 0) b = yield false;
                }
                // skip next /r/n (unless this is the last chunk)
                if (chunksize > 0) while(scanner.getNextLine(b) == null) b = yield false;
            } while(chunksize > 0);
            // read optional headers
            while((r.headers = scanner.getHeaders(b)) == null) b = yield false;
            // fire all headers call back or something?
        } else {
            // hmm... If no content-length was specified assume 2^31... (only used on client)
            // or should we error out here?
            len = parseInt(scanner.headers["content-length"]) || Math.pow(2,31)-1;
            while(len > 0) {
                [size,data] = scanner.getContent(b,len);
                if (size > 0) {
                    r.fire("data", data);
                    len -= size;
                }
                if (len > 0) b = yield false;
            }
        }
    }
    r.fire("end");
    yield true; // done
    }
}

// pump network buffers through the http/1.1 parser
function pumpReader(state, buffer, onReset) {
    // drain the buffer by parsing requests
    do {
        var r = buffer.remaining();
        if(state.send(buffer)) {
            onReset && onReset();
            // "reset" the parser and try the rest of the buffer for the next request
            state.next();
        }
        // continue until buffer is drained, or we cannot make any progress
        // in both cases we should wait for the next buffer to arrive from the network
    } while(buffer.hasRemaining() && buffer.remaining() < r);
}

function HttpWriter(method,url,headers,httpVersion,sock,req) {
    this.method = method.toUpperCase();
    this.url = url;
    if (headers != null) headers = this._augmentHeaders(headers);
    this.httpVersion = httpVersion;
    this.socket = sock;
    this.req = req;
    this.first = true;
}
HttpWriter.prototype = new event.Listener();

// Write some data. The data can be optionally encoded.
// The caller can also request to buffer the data before it is
// flushed to the kernel buffers.
// Data type allowed: String (js or Java), byte array, or a ByteBuffer
HttpWriter.prototype.write = function(data, enc, buffer) {
    this.first = false;
    if (typeof enc === "boolean") {
        buffer = enc;
        enc = undefined;
    }
    if (this.chunked) {
        let l, d;
        // determine encoded data and length
        // unfortunately Javascript and Java String are different
        if (typeof data === "string" || data instanceof String) {
            // get bytes for a Javascript string
            d = new java.lang.String(data).getBytes(enc||"UTF-8");
            l = d.length;
        } else if (data instanceof java.lang.String) {
            // java string
            d = data.getBytes(enc||"UTF-8");
            l = d.length;
        } else {
            // byte buffer or array
            d = data;
            l = d.length || d.remaining();
        }
        // always buffer whole chunks
        // call must ensure that the chunks fits into the send buffer
        this.socket.write(l.toString(16), null, true);
        this.socket.write(CRLF, null, true);
        this.socket.write(d, null, true);
        return this.socket.write(CRLF, null, buffer);
    } else {
        return this.socket.write(data, enc || "UTF-8", buffer);
    }
}

HttpWriter.prototype.end = function(data, enc) {
    // buffer if there were no write and the response is chunked
    if (data) this.write(data,enc,this.first && this.chunked === true);
    if (this.chunked) {
        // write the last chunk (and flush the buffer)
        this.socket.write(LASTCHUNK);
    }
    // close the close if this is a server response and keep alive was not requested
    if (this.req && !this.req.isKeepAlive())
        this.socket.end();
}

// write/buffer the header
HttpWriter.prototype.writeHead = function(statusCode, hdrs) {
    this.headers = this._augmentHeaders(hdrs);
    var a = "HTTP/"+this.httpVersion+" "+statusCode+" "+Headers[statusCode]+jsCRLF;
    this._writeHeaders(a, true); // buffer the header
}

// treat headers for correct http/1.1 behavior
HttpWriter.prototype._augmentHeaders = function(hdrs) {
    var contentLength,close,connection,transferEncoding;
    //hdrs = Object.create(hdrs);
    for(let h in hdrs) {
        if(contentLengthRegex.test(h)) {
            contentLength = hdrs[h];
        } else if(transferEncodingRegex.test(h)) {
            transferEncoding = true;
            this.chunked = chunkedRegex.test(hdrs[h]);
        } else if(connectionRegex.test(h)) {
            connection = true;
            close = closeRegex.test(hdrs[h]);
        }
    }
    if (!this.req || this.req.isKeepAlive()) {
        if (!connection)
            hdrs.Connection = "keep-alive";
        if (!contentLength && !transferEncoding && !close) {
            hdrs["Transfer-Encoding"] = "chunked";
            this.chunked = true;
        }               
    } else if (!connection)
        hdrs.Connection = "close";

    return hdrs;
}

// write out or buffer the header
HttpWriter.prototype._writeHeaders = function(a,buffer) {
    for(var h in this.headers) {
        a += h+": "+this.headers[h]+jsCRLF;
    }
    a+=jsCRLF;
    this.socket.write(a,null,buffer);
}

// for clients
HttpWriter.prototype._writeRequestHead = function() {
    var a = this.method+" "+this.url+" HTTP/"+this.httpVersion+jsCRLF;
    this._writeHeaders(a); // don't buffer here
}

function Server(cb) {
    if (cb) this.on("request", cb);
    this.on("connection", acceptListener);
}
Server.prototype = new net.Server();
Server.prototype.isServer = true;

function acceptListener(socket) {
    var self = this;
    var state = parseState(self,socket);
    state.next(); // start it
    socket.on("data",function(data) {pumpReader(state,data);});
    socket.on("drain",function() {this.currentWriter.fire("drain");});
    socket.on("end",function() {
            state.close();
            this.end();
        });
}

function createServer(cb) {
    var server = new Server(cb);
    return server;
}

// proxy that mapped client requests to responses from the net
// (for http/1.1 pipelining)
function RequestProxy(client) {
    this.reqs = [];
    this.client = client;
}
RequestProxy.prototype = new event.Listener();
RequestProxy.prototype.addReq = function(req) {
    this.reqs.push(req);
}
RequestProxy.prototype.currentRequest = function() {
    return this.reqs[0];
}

function Client(port, host) {
    this.port = port;
    this.host = host;
    this.n = 0;
    this.proxy = new RequestProxy(this);
    this.proxy.on("response", function(res) {
            // pass the response to the right request
            this.reqs[0].fire("response", res);
            this.reqs.shift();
        });
}

Client.prototype = new event.Listener();

Client.prototype.request = function(method, uri, hdrs) {
    if (typeof(uri) !== "string") {
        hdrs = uri;
        uri = method;
        method = "GET";
    }
    var self = this;
    var req;
    this.n++;
    if (!this.socket) {
        // setup the socket and http parser if needed
        this.socket = net.createConnection(this.port,this.host);
        this.socket.on("data", function(data) {pumpReader(self.state,data,function() {--self.n;});});
        this.socket.on("end",function() {this.end();self.state.close();});
        this.socket.on("error",function (error) {self.fire("error",error);});
        this.socket.on("drain", function() {self.proxy.currentRequest().fire("drain");});
        this.state = parseState(this.proxy,this.socket);
        this.state.next();
    }

    req = new HttpWriter(method, uri, hdrs, "1.1", this.socket);
    this.proxy.addReq(req);
    req._writeRequestHead();
    return req;
}

Client.prototype.close = function() {
    if (this.socket) {
        this.socket.close();
        //this.state.close(); // ??
    }
}

function createClient(port, host) {
    var c = new Client(port, host);
    return c;
}

exports.createServer=createServer;
exports.createClient=createClient;
