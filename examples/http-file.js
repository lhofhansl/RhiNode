var http = require('http');
var fs = require('fs');
var server = http.createServer(function (req,res) {
        res.writeHead(200,{"Content-type":"text/plain","Content-length":"1669688"});
        var s = fs.createReadStream('/usr/bin/Xnest'); // or some big file :)
        fs.copyStream(s,res);
    }).listen(8000, 'localhost');
