http = require('http');
var c = http.createClient(8000, "127.0.0.1");
var n = 0;
var res = 0;
function handler(response) {
    response.setEncoding("UTF-8");
    response.on("data", function(data) {
            if (++res % 1000 == 0) {
                console.log("res:"+res);
                console.log("data:"+data);
            }
        });
    if (n++ < 10000) {
        var r = c.request("GET","/");
        r.on("response",handler);
        r.end();
    } else {
        c.close();
    }
    /*
    response.on("end",function() {
            console.log("done");
        });
    */
}

var r = c.request("GET", "/");
r.on("response",handler);
r.end();
