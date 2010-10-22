// adapted from code found in a mailing list by Attila Szegedi
package org.rhinode;

import org.mozilla.javascript.WrapFactory;
import org.mozilla.javascript.Context;
import org.mozilla.javascript.Scriptable;
import org.mozilla.javascript.NativeJavaObject;
import org.mozilla.javascript.ScriptRuntime;
import java.util.List;
import java.util.Map;

public class EnhancedWrapFactory extends WrapFactory {
    public EnhancedWrapFactory() {
        //setJavaPrimitiveWrap(false); 
    }

    @Override
    public Scriptable wrapAsJavaObject(Context cx, Scriptable scope, Object javaObject, Class<?> staticType) {
        if(javaObject instanceof Map) {
            return new NativeMapAdapter(scope, javaObject, staticType);
        } else if(javaObject instanceof List) {
            return new NativeListAdapter(scope, javaObject, staticType);
        } else {
            return super.wrapAsJavaObject(cx,scope,javaObject,staticType);
        }
    }

    private static class NativeMapAdapter extends NativeJavaObject {
        public static final long serialVersionUID = 1L;

        public NativeMapAdapter(Scriptable scope, Object javaObject, Class staticType) {
            super(scope, javaObject, staticType);
        }

        private Map getMap() {
            return (Map)javaObject;
        }

        public void delete(String name) {
            try {
                getMap().remove(name);
            } catch(RuntimeException e) {
                Context.throwAsScriptRuntimeEx(e);
            }
        }

        public Object get(int i, Scriptable start) {
            return get(""+i, start);
        }

        public Object get(String name, Scriptable start) {
            Object value = super.get(name, start);
            if(value != Scriptable.NOT_FOUND) {
                return value;
            }
            value = getMap().get(name);
            if(value == null) {
                return Scriptable.NOT_FOUND;
            }
            Context cx = Context.getCurrentContext();
            return cx.getWrapFactory().wrap(cx, this, value, null);
        }

        public String getClassName() { return "NativeMapAdapter"; }

        public Object[] getIds() { return getMap().keySet().toArray(); }

        public boolean has(String name, Scriptable start) { return getMap().containsKey(name) || super.has(name, start); }

        public void put(int i, Scriptable start, Object value) {
            put(""+i,start,value);
        }

        public void put(String name, Scriptable start, Object value) {
            try {
                getMap().put(name, Context.jsToJava(value, ScriptRuntime.ObjectClass));
            } catch(RuntimeException e) {
                Context.throwAsScriptRuntimeEx(e);
            }
        }

        public String toString() { return javaObject.toString(); }
    }

    private static class NativeListAdapter extends NativeJavaObject {
        public static final long serialVersionUID = 1L;

        public NativeListAdapter(Scriptable scope, Object javaObject, Class staticType) {
            super(scope, javaObject, staticType);
        }

        private List getList() { return (List)javaObject; }
    
        public void delete(int index) {
            try {
                getList().remove(index);
            } catch(RuntimeException e) {
                throw Context.throwAsScriptRuntimeEx(e);
            }
        }

        public Object get(int index, Scriptable start) {
            Context cx = Context.getCurrentContext();
            try {
                return cx.getWrapFactory().wrap(cx, this, getList().get(index), null);
            } catch(RuntimeException e) {
                throw Context.throwAsScriptRuntimeEx(e);
            }
        }

        public String getClassName() { return "NativeListAdapter"; }

        public Object[] getIds() {
            int size = getList().size();
            Integer[] ids = new Integer[size];
            for(int i = 0; i < size; ++i) {
                ids[i] = new Integer(i);
            } 
            return ids;
        }

        public boolean has(int index, Scriptable start) { return index >= 0 && index < getList().size(); }

        public void put(int index, Scriptable start, Object value) {
            try {
                getList().set(index, Context.jsToJava(value, ScriptRuntime.ObjectClass));
            } catch(RuntimeException e) {
                Context.throwAsScriptRuntimeEx(e);
            }
        }

        public String toString() { return javaObject.toString(); }
    } 
}
