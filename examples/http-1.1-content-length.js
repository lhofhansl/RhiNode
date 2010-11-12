var http = require('http')

s = http.createServer(function(req,res) {
        res.writeHead(200,{'Content-length':'12','Content-Type':'text/plain'})
        res.end('Hello World\n')
    });
s.listen(8000, "localhost");

console.log('Running at http://127.0.0.1:8000/')
