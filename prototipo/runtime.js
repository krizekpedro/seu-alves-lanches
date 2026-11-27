/* Mini motor de telas do protótipo: lê o <template id="tpl"> e redesenha a cada setState.
   Suporta {{valor}}, <sc-if value>, <sc-for list as> e onClick/onChange. */
(function () {
  var EXACT = /^\s*\{\{\s*([^}]+?)\s*\}\}\s*$/;
  function get(scope, expr) {
    expr = expr.trim();
    if (expr === 'true') return true;
    if (expr === 'false') return false;
    if (/^-?\d+(\.\d+)?$/.test(expr)) return +expr;
    var parts = expr.split('.');
    for (var i = scope.length - 1; i >= 0; i--) {
      var s = scope[i];
      if (s && Object.prototype.hasOwnProperty.call(s, parts[0])) {
        var v = s[parts[0]];
        for (var j = 1; j < parts.length; j++) v = v == null ? undefined : v[parts[j]];
        return v;
      }
    }
    return undefined;
  }
  function interp(str, scope) {
    return str.replace(/\{\{([^}]+)\}\}/g, function (_, e) { var v = get(scope, e); return v == null ? '' : String(v); });
  }
  function exprOf(attr) { var m = EXACT.exec(attr || ''); return m ? m[1] : null; }
  var EVENTS = { onclick: 'click', onchange: 'input', oninput: 'input' };
  function build(node, scope, out) {
    if (node.nodeType === 3) { out.push(document.createTextNode(interp(node.nodeValue, scope))); return; }
    if (node.nodeType !== 1) return;
    var tag = node.localName;
    if (tag === 'sc-if') {
      if (get(scope, exprOf(node.getAttribute('value')) || 'false')) node.childNodes.forEach(function (c) { build(c, scope, out); });
      return;
    }
    if (tag === 'sc-for') {
      var list = get(scope, exprOf(node.getAttribute('list')) || '') || [], as = node.getAttribute('as');
      list.forEach(function (item) { var o = {}; o[as] = item; var sc = scope.concat([o]); node.childNodes.forEach(function (c) { build(c, sc, out); }); });
      return;
    }
    var el = node.namespaceURI === 'http://www.w3.org/1999/xhtml' ? document.createElement(tag) : document.createElementNS(node.namespaceURI, node.tagName);
    for (var i = 0; i < node.attributes.length; i++) {
      var a = node.attributes[i], name = a.name.toLowerCase();
      if (name.indexOf('hint-') === 0) continue;
      var ex = exprOf(a.value);
      if (EVENTS[name] && ex) { (function (fn) { if (typeof fn === 'function') el.addEventListener(EVENTS[name], function (e) { fn(e); }); })(get(scope, ex)); continue; }
      el.setAttribute(a.name, interp(a.value, scope));
    }
    var kids = [];
    node.childNodes.forEach(function (c) { build(c, scope, kids); });
    kids.forEach(function (k) { el.appendChild(k); });
    out.push(el);
  }
  var SCROLLERS = '[style*="overflow-y: auto"],[style*="overflow: auto"],[style*="overflow-x: auto"]';
  window.DCLogic = function DCLogic(props) { this.props = props || {}; this.state = {}; };
  window.DCLogic.prototype.setState = function (o) {
    Object.assign(this.state, typeof o === 'function' ? o(this.state) : o);
    if (this.__render && !this.__queued) { var self = this; this.__queued = true; Promise.resolve().then(function () { self.__queued = false; self.__render(); }); }
  };
  window.DC = {
    mount: function (Component) {
      var app = document.getElementById('app'), tpl = document.getElementById('tpl').content, comp = new Component({});
      comp.__render = function () {
        var scrolls = Array.prototype.map.call(app.querySelectorAll(SCROLLERS), function (e) { return [e.scrollTop, e.scrollLeft]; });
        var fields = app.querySelectorAll('input,textarea,select'), act = document.activeElement, fi = Array.prototype.indexOf.call(fields, act), sel = fi >= 0 && act.selectionStart != null ? [act.selectionStart, act.selectionEnd] : null;
        var vals = comp.renderVals(), out = [];
        tpl.childNodes.forEach(function (c) { build(c, [vals], out); });
        app.replaceChildren.apply(app, out);
        app.querySelectorAll(SCROLLERS).forEach(function (e, i) { if (scrolls[i]) { e.scrollTop = scrolls[i][0]; e.scrollLeft = scrolls[i][1]; } });
        if (fi >= 0) { var nf = app.querySelectorAll('input,textarea,select')[fi]; if (nf) { nf.focus(); if (sel && nf.setSelectionRange) try { nf.setSelectionRange(sel[0], sel[1]); } catch (e) {} } }
      };
      comp.__render();
    }
  };
})();
