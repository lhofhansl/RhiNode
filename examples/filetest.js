var fs = require('fs');
s = fs.createReadStream('/etc/hosts');
s.setEncoding("UTF-8");
s.on('data', function(data) {
        print(data);
    });

w = fs.createWriteStream("test.txt");
w.write("abc");
w.end();