package org.rhinode;

import java.nio.*;
import java.nio.charset.*;
import java.io.*;
import java.util.*;
public class HttpScanner {
    static Set<String> multipleValues = new HashSet<String>();
    static {
        multipleValues.add("accept");
        multipleValues.add("accept-charset");
        multipleValues.add("accept-encoding");
        multipleValues.add("accept-language");
        multipleValues.add("connection");
        multipleValues.add("cookie");
    }

    private StatefulDecoder decoder;
    private enum State { START,CR }
    private State s = State.START;
    // store partial lines here (in case a request list is larger than our receive buffer)
    private ByteArrayOutputStream tmp = new ByteArrayOutputStream(32);
    Map<String,String> headers = new HashMap<String,String>();


    public HttpScanner() {
    }

    public void reset() {
        s = State.START;
        tmp.reset();
        headers.clear();
        if (decoder != null)
            decoder.reset();
    }

    public Map<String, String> getHeaders() {
        return Collections.unmodifiableMap(headers);
    }

    public void setEncoding(String enc) {
        decoder = new StatefulDecoder(enc);
    }

    public String getNextLine(ByteBuffer buf) {
        while(buf.hasRemaining()) {
            byte b = buf.get();
            if (b == 13) s = State.CR; // should we just ignore CR and accept a line by LF only?
            else if (s == State.CR && b == 10) {
                String l=null;
                try {l = tmp.toString("US-ASCII");} catch(UnsupportedEncodingException x) {}
                tmp.reset();
                s = State.START;
                return l;
            } else {
                s = State.START;
                tmp.write(b);
            }
        }
        return null;
    }

    // convenience method (callers could use repeated getNextLine...)
    public Map<String,String> getHeaders(ByteBuffer buf) {
        String line;
        while((line = getNextLine(buf)) != null) {
            if (line.length() == 0) {
                return getHeaders();
            } else {
                int i = line.indexOf(':');
                if (i > 0) {
                    String key = line.substring(0,i).toLowerCase();
                    String newValue = line.substring(i+1).trim();
                    String oldValue = headers.get(key);
                    if (oldValue != null && multipleValues.contains(key) || key.startsWith("x-")) {
                        headers.put(key,oldValue+","+newValue);
                    } else {
                        headers.put(key, newValue);
                    }
                }
            }
        }
        return null;
    }

    /*
     * Retrieves as much content as possible, returns [length,data]
     */
    public Object[] getContent(ByteBuffer buf, int remaining) {
        ByteBuffer r;
        if (buf.remaining() <= remaining) {
            r = buf.slice();
        } else {
            r = ((ByteBuffer)buf.slice().limit(remaining)).slice();
        }
        // advance the buffer
        buf.position(buf.position()+r.remaining());
        if (this.decoder == null) {
            return new Object[] {r.remaining(),r};
        } else {
            return new Object[] {r.remaining(), decoder.decode(r)};
        }
    }
}
