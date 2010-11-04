package org.rhinode;

import java.nio.ByteBuffer;
import java.io.IOException;
import java.io.UnsupportedEncodingException;
import java.nio.channels.ReadableByteChannel;
import java.nio.channels.WritableByteChannel;

/*
 * Memory is held in a pool, as we use memory we draw it from
 * this pool. When the pool is exhausted we create a new one.
 *
 * The memory is not reused, hence downstream code can hold on the passed buffers.
 * Is allows for one BytePool to be shared by many streams.
 */
public class BytePool {
    private ByteBuffer pool = null;
    private static final int MIN = 256;       // these number are pulled
    private static final int SIZE = 64*1024;  // out of my *ss

    /*
     * Let more byte flow into the pool
     */
    private int pre() {
        if (pool==null || pool.remaining() < MIN) {
            pool = java.nio.ByteBuffer.allocate(SIZE);
        }
        return pool.position();
    }

    private ByteBuffer post(int p) {
        pool.limit(pool.position()).position(p);
        ByteBuffer r = pool.slice();
        pool.position(pool.limit()).limit(pool.capacity());
        return r;
    }

    public ByteBuffer readFrom(ReadableByteChannel channel) throws IOException {
        int p = pre();
        int n = -1;
        try {
            n = channel.read(pool);
        } catch(IOException x) {
        }
        //if (n==0) System.out.println("0?");
        if(n<0) 
            return null;

        return post(p);
    }
}
