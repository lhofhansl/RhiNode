package org.rhinode;

import java.io.*;
import java.nio.channels.*;
import java.nio.charset.*;
import java.nio.*;

// Outputstream backed by a growing ByteBuffer
public class ByteBufferOutputStream extends OutputStream {
    private CharsetDecoder decoder = null;
    private ByteBuffer buffer;
    private int max;

    public ByteBufferOutputStream(int size, int max) {
        buffer = ByteBuffer.allocate(size);
        this.max = max;
    }
    
    public void setEncoding(String enc) {
        decoder = Charset.forName(enc).newDecoder();
        decoder.onMalformedInput(CodingErrorAction.IGNORE);
        decoder.onUnmappableCharacter(CodingErrorAction.IGNORE);
    }

    @Override
    public void write(byte[] b, int off, int len) {
        ensureLen(len);
        buffer.put(b, off, len);
    }
    
    public void write(ByteBuffer b) {
        ensureLen(b.remaining());
    	buffer.put(b);
    }
    
    public void write(int b) {
        ensureLen(1);
        buffer.put((byte)b);
    }

    public void write(String data) {
        write(data,"US-ASCII");
    }

    public void write(String data, String enc) {
        byte[] a = null;
        try { a = data.getBytes(enc); } catch(UnsupportedEncodingException x) { /* now what? */ }
        ensureLen(a.length);
        buffer.put(a);
    }

    // convenience, can be used from script
    public void write(ByteBuffer b, String dummy) {
        write(b);
    }
    // convenience, can be used from script
    public void write(byte[] b, String dummy) {
        write(b, 0, b.length);
    }

    public void reset() {
        buffer.clear();
    }
    
    public int size() {
        return buffer.position();
    }

    public void compact() {
        buffer.flip();
        buffer = ByteBuffer.allocate(buffer.remaining()).put(buffer);
    }

    // returns # of bytes that still need to be sent
    public int writeTo(WritableByteChannel channel) throws IOException {
        buffer.flip();
        try {
        int n = channel.write(buffer);
        } catch (IOException x) {
            return -1;
        }
        buffer.compact();
        return size();
    }
    
    private void ensureLen(int len) {
        if(len > buffer.remaining() && buffer.capacity() < max) {
            int size = buffer.capacity();
            // at least double the size
            int nSize = Math.min(Math.max(size << 1, size + len), max);
            buffer.flip();
            buffer = ByteBuffer.allocate(nSize).put(buffer);
        }
    }
}
