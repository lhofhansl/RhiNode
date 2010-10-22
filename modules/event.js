//
// See DOM {add|remove}EventListener
// Use neat trick from node.js to store arrays only for multiple callbacks
//

function Listener() {}

Listener.prototype = {
    addEventListener: function(event, listener) {
        if (!this.events) this.events = {};
        var ev = this.events[event];
        if (ev) {
            if (typeof ev  === 'function') {
                this.events[event] = [ev,listener];
            } else {
                ev.push(listener);
            }
        } else {
            this.events[event] = listener;
        }
        return this;
    },
    removeEventListener: function(event) {
        var ev = this.events && this.events[event];
        if (ev) {
            // remove if last one, remove all if no listener was specified
            if (typeof ev === 'function' || !listener) {
                delete this.events[event];
            } else {
                var i = ev.indexOf(listener);
                if (i < 0) return this;
                ev.splice(i, 1);
                if (ev.length == 0) {
                    delete this.events[event];
                } else if (ev.length == 1) {
                    this.events[event] = ev[0];
                }
            }
        }
        return this;
    },
    fire: function(event) {
        var ev = this.events && this.events[event];
        if (ev) {
            var args;
            // neat trick from node.js
            if (typeof ev  === 'function') {
                if (arguments.length <= 3) {
                    ev.call(this,arguments[1],arguments[2]);
                } else {
                    args = Array.prototype.slice.call(arguments, 1);
                    ev.apply(this,args);
                }
            } else {
                args = Array.prototype.slice.call(arguments, 1);
                ev = ev.slice(0); // copy the array
                for each (var i in ev) i.apply(this,args);
            }
            return true;
        } else if (event === "error") {
            throw arguments[1];
        }
        return false;
    },
    eventListenerList: function(event) {
        var ev = this.events && this.events[event];
        return ev ? (typeof ev  === 'function' ? [ev] : ev) : [];
    },
    has: function(event) {
        return this.events && this.events[event];
    }
};
Listener.prototype.on = Listener.prototype.addEventListener;

// compatability with node.js
Listener.prototype.addListener = Listener.prototype.addEventListener;
Listener.prototype.emit = Listener.prototype.fire;

exports.Listener = Listener;
