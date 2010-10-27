package org.rhinode;

import java.nio.*;
import java.nio.charset.*;
/*
 * A simple decoder class wrapping a CharsetDecoder that retains state from the last call to decode.
 * Can be passed multiple buffers and will retain necessary state from the
 * previous buffer(s) to finish the decoding.
 */
public class StatefulDecoder {
    private CharsetDecoder decoder = null;
    private byte[] leftOver = null; // should this be a fixed-size ByteBuffer instead?

    public StatefulDecoder(String enc) {
        decoder = Charset.forName(enc).newDecoder();
        decoder.onMalformedInput(CodingErrorAction.IGNORE);
        decoder.onUnmappableCharacter(CodingErrorAction.IGNORE);
    }

    public void reset() {
        leftOver = null;
    }

    // pre condition: buf is ready for read (i.e. it was flipped)
    public String decode(ByteBuffer buf) {
        ByteBuffer b;
        if (leftOver != null) {
            // need to copy it all into one buffer... sigh. Hopefully this does not happen often.
            b = ByteBuffer.allocate(leftOver.length+buf.remaining());
            b.put(leftOver).put(buf);
            b.flip();
            leftOver = null;
        } else {
            b =  buf;
        }
        // decode as much of the bytes as we can
        // note that the buffer may end with partial multibyte characters
        // should we hold on to the char buffer and reuse it?
        CharBuffer out = CharBuffer.allocate((int)(b.remaining()*decoder.maxCharsPerByte()));
        decoder.decode(b,out,false);
        if (b.hasRemaining()) {
            // could not decode all characters
            //System.out.println("Rem:"+b.remaining());
            leftOver = new byte[b.remaining()];
            b.get(leftOver);
        }
        return out.flip().toString();
    }
}
