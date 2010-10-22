n1=n2=n3=0;
i1 = setInterval(function() {console.log(n1++);if (n1==1000) clearInterval(i1);},1);
i2 = setInterval(function() {console.log(n2++);if (n2==1000) clearInterval(i2);},10);
i3 = setInterval(function() {console.log(n3++);if (n3==1000) clearInterval(i3);},15);
setTimeout(function() {clearInterval(i3);console.log("*Stop*");}, 5000);
