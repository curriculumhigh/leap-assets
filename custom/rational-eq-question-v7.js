/**
 * Rational Equation — Learnosity Custom Question v7
 *
 * v7 changes over v6:
 *  - KaTeX-with-markers rendering: \htmlId markers inside KaTeX for ALL
 *    structures (fractions, superscripts, subscripts, \left/\right, \sqrt, etc.)
 *  - No HTML extraction — KaTeX handles all layout natively
 *  - Deleted: extractStructures, buildSegments, findClosingBrace,
 *    findMatchingRight, all segment type handling (~200 lines removed)
 *  - buildExpression is now ~30 lines instead of ~300
 *  - Compact MQ field sizing to match Learnosity native clozeformula
 *
 * v5 additions over v4:
 *  - factorFull validation: checks student's factored expression is fully factored
 *    over a specified field (integers, reals, or complex)
 *  - Permutation matching: factors can appear in any order across grouped inputs
 *  - Syntactic factor parser for single-box factored expressions
 *  - Irreducibility checker per field
 *
 * Inherited from v4:
 *  - Real-time sync, teacher live view, per-step visibility, debounced events
 *
 * Custom type: "rational_equation"
 */
LearnosityAmd.define(["jquery-v1.10.2"], function ($) {
    "use strict";

    // ── CDN URLs ──
    var CDN = {
        katexCSS:  "https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/katex.min.css",
        katexJS:   "https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/katex.min.js",
        katexAuto: "https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/contrib/auto-render.min.js",
        mqCSS:     "https://unpkg.com/mathquill@0.10.1/build/mathquill.css",
        mqJS:      "https://unpkg.com/mathquill@0.10.1/build/mathquill.js",
        nerdCore:  "https://cdn.jsdelivr.net/npm/nerdamer@1.1.13/nerdamer.core.js",
        nerdAlg:   "https://cdn.jsdelivr.net/npm/nerdamer@1.1.13/Algebra.js",
        nerdCalc:  "https://cdn.jsdelivr.net/npm/nerdamer@1.1.13/Calculus.js",
        nerdSolve: "https://cdn.jsdelivr.net/npm/nerdamer@1.1.13/Solve.js",
        nerdExtra: "https://cdn.jsdelivr.net/npm/nerdamer@1.1.13/Extra.js"
    };

    // ── Helpers: load external scripts/styles ──
    function loadCSS(url) {
        if ($('link[href="' + url + '"]').length) return;
        $("<link>", { rel: "stylesheet", href: url }).appendTo("head");
    }

    function loadScript(url, check) {
        if (check && check()) {
            return $.Deferred().resolve().promise();
        }
        return $.getScript(url).fail(function (jqxhr, settings, exception) {
            console.error("[rational-eq-v6] Failed to load: " + url, exception);
        });
    }

    function loadDeps() {
        loadCSS(CDN.katexCSS);
        loadCSS(CDN.mqCSS);
        if (!window.jQuery) window.jQuery = $;
        return loadScript(CDN.katexJS, function () { return window.katex; })
            .then(function () { return loadScript(CDN.katexAuto, function () { return window.renderMathInElement; }); })
            .then(function () { return loadScript(CDN.mqJS, function () { return window.MathQuill; }); })
            .then(function () { return loadScript(CDN.nerdCore, function () { return window.nerdamer; }); })
            .then(function () { return loadScript(CDN.nerdAlg); })
            .then(function () { return loadScript(CDN.nerdCalc); })
            .then(function () { return loadScript(CDN.nerdSolve); })
            .then(function () { return loadScript(CDN.nerdExtra); });
    }

    // ═════════════════════════════════════════════════
    // QUESTION CLASS
    // ═════════════════════════════════════════════════

    function Question(init, lrnUtils) {
        this.$el = init.$el;
        this.question = init.question;
        this.response = init.response;
        this.events = init.events;
        this.lrnUtils = lrnUtils;
        this.facade = init.getFacade ? init.getFacade() : null;
        this.state = init.state || "initial";

        // Detect teacher mode from LEAP URL
        var href = (window.location.href || "").toLowerCase();
        this.isTeacher = href.indexOf("worksheet-teacher") >= 0
            || href.indexOf("/classroom") >= 0
            || href.indexOf("teacher") >= 0;

        // Internal state
        this.MQ = null;
        this.mqFields = {};
        this.completedSections = {};
        this.completedRows = {};
        this.unlockedRows = {};
        this.focusedMQField = null;
        this.uid = "req-" + Math.random().toString(36).slice(2, 8);
        this._disabled = false;
        this._changedTimer = null;

        // Fire ready immediately so Learnosity doesn't time out
        init.events.trigger("ready");

        // Wire Learnosity's "Check Answer" button validate event
        var self = this;
        init.events.on("validate", function () { self.validateCurrentStep(); });

        loadDeps().then(function () {
            self.MQ = MathQuill.getInterface(2);
            self.render();
        }).fail(function (err) {
            console.error("[rational-eq-v6] loadDeps failed:", err);
            $(self.$el).html('<p style="color:red;">Failed to load dependencies. Check console.</p>');
        });
    }

    Question.prototype.render = function () {
        var q = this.question;
        var self = this;

        var $w = $('<div class="req-widget" style="position:relative;"></div>');

        // Hide Learnosity's raw stimulus rendering
        self.$el.closest(".lrn_widget, .lrn-question, .lrn_response_wrapper")
            .parent().find(".lrn_stimulus").hide();

        // Render stimulus with KaTeX
        var stim = q.stimulus || "";
        if (stim) {
            $w.append($('<p style="font-size:15px;line-height:1.7;margin:0 0 14px;"></p>').html(stim));
        }

        // Sections — wrapped in scaffold-block (blue left bar) per STEP.
        // A new step starts at: the first section of a group, or any text section within a group.
        var sections = q.sections || [];
        var currentGroup = null;
        var $currentStepDiv = null;
        var stepCounter = 0;
        self.groupFirstIndex = {};

        sections.forEach(function (sec, si) {
            var $sec;
            if (sec.type === "text") {
                $sec = self.buildTextSection(sec);
            } else if (sec.type === "equation-table") {
                $sec = self.buildEquationTableSection(sec);
            } else if (sec.type === "text-with-input") {
                $sec = self.buildTextWithInputSection(sec);
            }
            if (!$sec) return;

            if (sec.group) {
                var isNewGroup = sec.group !== currentGroup;
                if (isNewGroup) {
                    currentGroup = sec.group;
                    self.groupFirstIndex[sec.group] = si;
                }

                // Start a new step block on: new group, or text section within a group
                var isNewStep = isNewGroup || sec.type === "text";
                if (isNewStep) {
                    stepCounter++;
                    $currentStepDiv = $('<div class="req-scaffold-block" id="' + self.uid + '-step-' + stepCounter + '"></div>');
                    // Also tag with group ID for unlock logic
                    $currentStepDiv.attr("data-group", sec.group);
                    if (si > 0) $currentStepDiv.addClass("req-section-locked");
                    $w.append($currentStepDiv);
                }

                if (si !== self.groupFirstIndex[sec.group] && !isNewStep) {
                    $sec.addClass("req-section-locked");
                } else if (isNewStep && si !== self.groupFirstIndex[sec.group]) {
                    // The text section that starts a new step within a group is locked
                    $sec.addClass("req-section-locked");
                }
                $currentStepDiv.append($sec);
            } else {
                currentGroup = null;
                $currentStepDiv = null;
                if (si > 0) $sec.addClass("req-section-locked");
                $w.append($sec);
            }
        });

        // Done banner
        $w.append($('<div class="req-done" id="' + self.uid + '-done">All steps complete!</div>'));

        // Global hint (legacy — per-step hints are now inline)

        // Keypad
        self.buildKeypad($w);

        this.$el.empty().append($w);
        self.renderKaTeX($w[0]);

        // Hide keypad when clicking outside MQ fields and keypad
        $(document).on("mousedown." + self.uid, function (ev) {
            var $t = $(ev.target);
            if ($t.closest(".req-keypad, .mq-editable-field, .req-mq-slot").length) return;
            $("#" + self.uid + "-keypad").removeClass("visible");
            self.focusedMQField = null;
        });

        // Branch based on state and role
        if (self.isTeacher) {
            // v4: Teacher live view — grayed out, real-time updates, step progress
            setTimeout(function () {
                self._applyTeacherLiveMode();
                // If there's already a saved response, populate from it
                if (self.response && self.response.inputs) {
                    self._updateTeacherFromResponse(self.response);
                }
            }, 200);

            // Listen for response updates from student via multiple mechanisms:
            // 1. Facade "changed" event
            if (self.facade && self.facade.on) {
                self.facade.on("changed", function () {
                    var resp = self.facade.getResponse();
                    if (resp) self._updateTeacherFromResponse(resp);
                });
            }
            // 2. Learnosity events "changed" (fired by student side)
            self.events.on("changed", function (resp) {
                if (resp) self._updateTeacherFromResponse(resp);
            });
            // 3. Poll for response changes (fallback for sync delays)
            self._pollInterval = setInterval(function () {
                try {
                    var resp = self.facade ? self.facade.getResponse() : null;
                    if (resp && resp.inputs) self._updateTeacherFromResponse(resp);
                } catch (e) {}
            }, 2000);
        } else if (self.state === "review") {
            // Pure review mode (non-teacher): static read-only with correct answers
            setTimeout(function () {
                self.applyReviewMode();
                self.renderCorrectAnswersPanel();
            }, 200);
        } else if (self.state === "resume") {
            // Student resume: restore progress and continue interactively
            setTimeout(function () { self.restoreFromResponse(self.response); }, 200);
        } else {
            // Student initial: interactive flow
            self.unlockSection(0);
        }
    };

    // ── v4: Debounced "changed" event to sync student input in real time ──
    Question.prototype._fireChanged = function () {
        var self = this;
        if (self._changedTimer) clearTimeout(self._changedTimer);
        self._changedTimer = setTimeout(function () {
            self.events.trigger("changed", self.getResponse());
        }, 150);
    };

    // ── KaTeX rendering ──
    Question.prototype.renderKaTeX = function (el) {
        if (typeof renderMathInElement !== "function") return;
        renderMathInElement(el, {
            delimiters: [
                { left: "$$", right: "$$", display: true },
                { left: "$", right: "$", display: false },
                { left: "\\(", right: "\\)", display: false },
                { left: "\\[", right: "\\]", display: true }
            ],
            throwOnError: false,
            trust: true
        });
    };

    // ── Render hint HTML: "Hint:" label + KaTeX math rendering for $...$ blocks ──
    Question.prototype._renderHint = function (hintText) {
        // Render $...$ and $$...$$ as KaTeX
        var rendered = hintText.replace(/\$\$([^$]+)\$\$/g, function (m, latex) {
            try { return '<div class="katex-display">' + katex.renderToString(latex.trim(), { throwOnError: false, displayMode: true, trust: true }) + '</div>'; }
            catch (e) { return m; }
        }).replace(/\$([^$]+)\$/g, function (m, latex) {
            try { return katex.renderToString(latex.trim(), { throwOnError: false, trust: true }); }
            catch (e) { return m; }
        });
        // Single-line: no newlines, no display math, no <br>, no block tags
        var isMultiline = /\n|<br|<div|<p |<ul|<ol|katex-display/.test(hintText) || /katex-display/.test(rendered);
        var modeClass = isMultiline ? 'req-hint-multiline' : 'req-hint-inline';
        return { html: '<span class="req-hint-label">Hint:</span><span class="req-hint-body">' + rendered + '</span>', modeClass: modeClass };
    };

    // ── Auto-detect math in DN option text and render with KaTeX ──
    Question.prototype._renderDNOption = function (text) {
        var hasMath = /\\[a-zA-Z]|[_^{}\d=+*/()<>≤≥≠]|\$/.test(text) || /^[a-zA-Z]$/.test(text.trim());
        if (!hasMath) return null; // caller should use plain text

        // If text contains $...$ inline math, split on $ boundaries:
        // odd segments are math, even segments are prose → wrap prose in \text{}
        if (/\$[^$]+\$/.test(text)) {
            var parts = text.split('$');
            var latex = '';
            for (var pi = 0; pi < parts.length; pi++) {
                if (!parts[pi]) continue;
                if (pi % 2 === 1) {
                    // Inside $...$ — raw math
                    latex += parts[pi];
                } else {
                    // Prose — wrap in \text{}
                    var prose = parts[pi].trim();
                    if (prose) latex += '~\\text{' + prose + '}~';
                }
            }
            latex = latex.replace(/^~|~$/g, '').replace(/~~+/g, '~');
            try { return katex.renderToString(latex, { throwOnError: false, trust: true }); }
            catch (e) { return null; }
        }

        var latex = text.replace(/^\$+|\$+$/g, '');
        // If already contains \text{}, it's pre-formatted LaTeX — render directly
        if (/\\text\{/.test(latex)) {
            try { return katex.renderToString(latex, { throwOnError: false, trust: true }); }
            catch (e) { return null; }
        }
        // Convert a/b to \frac{a}{b}
        latex = latex.replace(/([a-zA-Z0-9]+|\([^)]+\)|\{[^}]+\})\/([a-zA-Z0-9]+|\([^)]+\)|\{[^}]+\})/g, function (_, n, d) {
            return '\\frac{' + n + '}{' + d + '}';
        });
        // Wrap English prose in \text{} with ~ spacing, skip LaTeX command names.
        // A prose run starts with a 2+ letter word OR a single letter followed by
        // a 2+ letter word, and continues with any word (including single-letter).
        latex = latex.replace(/(?<!\\)\b((?:[a-zA-Z]{2,}|[a-zA-Z](?=\s+[a-zA-Z]{2,}))(?:\s+(?!\\)[a-zA-Z]+)*)/g, function (m) {
            return '~\\text{' + m + '}~';
        });
        latex = latex.replace(/^~|~$/g, '').replace(/~~+/g, '~');
        try { return katex.renderToString(latex, { throwOnError: false, trust: true }); }
        catch (e) { return null; }
    };

    // ── Custom dropdown with KaTeX-rendered options ──
    Question.prototype._buildDropdown = function (id, options, onChange) {
        var self = this;
        var $wrap = $('<span class="req-dropdown-wrap" id="' + id + '"></span>');
        var $selected = $('<span class="req-dd-selected">Select\u2026</span>');
        var $arrow = $('<span class="req-dd-arrow">\u25BE</span>');
        var $trigger = $('<span class="req-dd-trigger"></span>').append($selected).append($arrow);
        var $menu = $('<span class="req-dd-menu"></span>');

        // Shuffle options so the correct answer isn't always in the same position
        var shuffled = options.slice();
        for (var si = shuffled.length - 1; si > 0; si--) {
            var sj = Math.floor(Math.random() * (si + 1));
            var tmp = shuffled[si]; shuffled[si] = shuffled[sj]; shuffled[sj] = tmp;
        }

        shuffled.forEach(function (opt) {
            var $item = $('<span class="req-dd-item" data-value="' + opt.replace(/"/g, '&quot;') + '"></span>');
            var rendered = self._renderDNOption(opt);
            if (rendered) { $item.html(rendered); } else { $item.text(opt); }
            $item.on("click", function (e) {
                e.stopPropagation();
                $wrap.attr("data-value", opt);
                var rSel = self._renderDNOption(opt);
                if (rSel) { $selected.html(rSel); } else { $selected.text(opt); }
                $trigger.css('min-width', ''); // shrink to fit selected option
                $menu.removeClass("open");
                if (onChange) onChange();
            });
            $menu.append($item);
        });

        $trigger.on("click", function (e) {
            e.stopPropagation();
            $(".req-dd-menu.open").not($menu).removeClass("open");
            $menu.toggleClass("open");
        });
        $(document).on("click", function () { $menu.removeClass("open"); });

        $wrap.append($trigger).append($menu);

        // Size trigger to the widest option initially, then shrink on selection
        requestAnimationFrame(function () {
            var $m = $('<span class="req-dd-item" style="visibility:hidden;position:absolute;white-space:nowrap;font-size:15px;"></span>');
            $(document.body).append($m);
            var maxW = 0;
            options.forEach(function (opt) {
                var r = self._renderDNOption(opt);
                if (r) { $m.html(r); } else { $m.text(opt); }
                var w = $m.outerWidth();
                if (w > maxW) maxW = w;
            });
            $m.remove();
            if (maxW > 0) {
                // Add padding for arrow + gap
                $trigger.css('min-width', (maxW + 32) + 'px');
            }
        });

        // getValue helper
        $wrap[0].getValue = function () { return $wrap.attr("data-value") || ""; };
        $wrap[0].setValue = function (v) {
            $wrap.attr("data-value", v);
            var r = self._renderDNOption(v);
            if (r) { $selected.html(r); } else { $selected.text(v); }
        };
        $wrap[0].setDisabled = function (d) { $wrap.toggleClass("req-dd-disabled", d); };
        return $wrap;
    };

    // ── Marker-based template helpers ──
    // For templates where {{N}} appears inside LaTeX structures like \dfrac{}{},
    // we can't split-and-wrap. Instead we replace {{N}} with text markers,
    // render the whole thing as one KaTeX expression, then swap markers for
    // MathQuill input fields (or dropdowns).

    // Strip <<>> container delimiters (visual hints for the editor, not renderer)
    Question.prototype._stripContainerDelims = function (tpl) {
        return tpl.replace(/<<|>>/g, "");
    };

    // Move DN (dropdown) placeholders out of $...$ math zones so they render
    // as prose HTML spans instead of KaTeX markers. This prevents dead space
    // from KaTeX fixed-width wrappers around dropdowns.
    // e.g. "$x = {{0}}$" → "$x =$ {{0}}" when input 0 is a dropdown.
    Question.prototype._extractDNFromMath = function (tpl, inputs) {
        if (!inputs) return tpl;
        return tpl.replace(/(\$\$[\s\S]*?\$\$|\$[^$]*?\$)/g, function (mathBlock) {
            // Check if any {{N}} in this math block corresponds to a dropdown input
            var hasDN = false;
            mathBlock.replace(/\{\{(\d+)\}\}/g, function (m, n) {
                var inp = inputs[parseInt(n)];
                if (inp && inp.type === "dropdown") hasDN = true;
            });
            if (!hasDN) return mathBlock;
            // Split math block at DN placeholders: close $ before, reopen after
            var delim = mathBlock.charAt(0) === '$' && mathBlock.charAt(1) === '$' ? '$$' : '$';
            var inner = mathBlock.slice(delim.length, mathBlock.length - delim.length);
            // Split on {{N}} where N is a DN input
            var result = inner.replace(/\{\{(\d+)\}\}/g, function (m, n) {
                var inp = inputs[parseInt(n)];
                if (inp && inp.type === "dropdown") {
                    return delim + " " + m + " " + delim;
                }
                return m;
            });
            return delim + result + delim;
        });
    };

    // Convert newlines in text to HTML: detect ordered/unordered lists, remaining \n → <br>
    Question.prototype._formatTextBlock = function (text) {
        if (!text || text.indexOf("\n") === -1) return text;
        var lines = text.split("\n");
        var out = "";
        var i = 0;
        while (i < lines.length) {
            var olMatch = lines[i].match(/^(\d+)\.\s+(.*)/);
            var ulMatch = lines[i].match(/^[-*]\s+(.*)/);
            if (olMatch) {
                out += "<ol style='margin:6px 0 6px 18px;padding:0;'>";
                while (i < lines.length && (olMatch = lines[i].match(/^\d+\.\s+(.*)/))) {
                    out += "<li>" + olMatch[1] + "</li>";
                    i++;
                }
                out += "</ol>";
            } else if (ulMatch) {
                out += "<ul style='margin:6px 0 6px 18px;padding:0;'>";
                while (i < lines.length && (ulMatch = lines[i].match(/^[-*]\s+(.*)/))) {
                    out += "<li>" + ulMatch[1] + "</li>";
                    i++;
                }
                out += "</ul>";
            } else {
                if (i > 0 && lines[i].trim()) out += "<br>";
                out += lines[i];
                i++;
            }
        }
        return out;
    };

    // Replace {{N}} with \htmlId placeholder boxes in a LaTeX string.
    // KaTeX renders \htmlId{id}{content} as <span id="id">content</span>,
    // which we can find with getElementById after rendering.
    Question.prototype._insertMarkers = function (latex, prefix) {
        var marked = latex.replace(/\{\{(\d+)\}\}/g, function (m, n) {
            return "\\htmlId{" + prefix + n + "}{\\boxed{\\strut\\phantom{x}}}";
        });
        // Promote \frac → \dfrac (display-style) when containing input markers.
        // \dfrac has more vertical space so the frac-line stays visible between MQ fields.
        // Regex: match \frac{ only when NOT preceded by 'd' (to avoid corrupting \dfrac).
        if (marked.indexOf("\\htmlId{") !== -1) {
            marked = marked.replace(/(^|[^d])\\frac\{/g, "$1\\dfrac{");
        }
        return marked;
    };

    // Find rendered placeholder elements by ID and replace with input elements.
    Question.prototype._replaceMarkers = function (root, prefix, inputs, mkId) {
        var self = this;
        inputs.forEach(function (inp, idx) {
            var phEl = root.querySelector('[id="' + prefix + idx + '"]') || document.getElementById(prefix + idx);
            if (!phEl) return;

            var replacement;
            if (inp && inp.type === "dropdown") {
                var $dd = self._buildDropdown(mkId(idx, "dd"), inp.options || [], function () { self._fireChanged(); });
                replacement = $dd[0];
            } else {
                replacement = $('<span class="mq-slot" id="' + mkId(idx, "mq") + '" style="display:inline-block;vertical-align:middle;"></span>')[0];
            }

            phEl.parentNode.replaceChild(replacement, phEl);
        });
    };

    // ── Validation utilities ──
    Question.prototype.latexToNerdamer = function (latex) {
        var s = latex.trim();
        s = s.replace(/\\left/g, "").replace(/\\right/g, "");
        while (s.match(/\\d?frac\{([^{}]+)\}\{([^{}]+)\}/)) {
            s = s.replace(/\\d?frac\{([^{}]+)\}\{([^{}]+)\}/g, "(($1)/($2))");
        }
        s = s.replace(/\\cdot/g, "*");
        s = s.replace(/\\times/g, "*");
        s = s.replace(/\\div/g, "/");
        s = s.replace(/\\[,;:!]/g, "");
        // \ln with parens or space+arg → nerdamer's log (natural log)
        s = s.replace(/\\ln\s*\(([^()]+)\)/g, "log($1)");
        s = s.replace(/\\ln\s+([a-zA-Z0-9])/g, "log($1)");
        s = s.replace(/\\ln\b/g, "log");
        // \log with subscript → change of base: \log_{b}(x) → log(x)/log(b)
        s = s.replace(/\\log_\{([^{}]+)\}\s*\(([^()]+)\)/g, "(log($2)/log($1))");
        s = s.replace(/\\log_\{([^{}]+)\}\s*([a-zA-Z0-9])/g, "(log($2)/log($1))");
        // Bare \log (no subscript) means base-10: \log(x) → log(x)/log(10)
        s = s.replace(/\\log\s*\(([^()]+)\)/g, "(log($1)/log(10))");
        s = s.replace(/\\log\s+([a-zA-Z0-9])/g, "(log($1)/log(10))");
        s = s.replace(/\\log\b/g, "log"); // fallback — shouldn't normally reach here
        s = s.replace(/\^{([^{}]+)}/g, "^($1)");
        s = s.replace(/_\{([^{}]+)\}/g, "_($1)");
        s = s.replace(/(\d)([a-zA-Z])/g, "$1*$2");
        s = s.replace(/\\sqrt\{([^{}]+)\}/g, "sqrt($1)");
        s = s.replace(/\\sqrt\s*([a-zA-Z0-9])/g, "sqrt($1)");
        s = s.replace(/\\(?!pi|e|sqrt|ln|log|sin|cos|tan|infty)/g, "");
        // Implicit multiplication between adjacent single-letter variables.
        // Protect known function names with non-letter placeholders.
        var funcPH = {};
        var fIdx = 0;
        s = s.replace(/\b(sqrt|log|sin|cos|tan|pi|infty)\b/g, function (m) {
            var ph = "#" + (fIdx++) + "#";
            funcPH[ph] = m;
            return ph;
        });
        // Insert * between adjacent letters: xy → x*y
        while (/([a-z])([a-z])/i.test(s)) {
            s = s.replace(/([a-z])([a-z])/gi, "$1*$2");
        }
        // Also: )letter, )digit, )(, digit(, letter(
        s = s.replace(/\)([a-zA-Z0-9])/g, ")*$1");
        s = s.replace(/([a-zA-Z0-9])\(/g, "$1*(");
        s = s.replace(/\)\(/g, ")*(");
        // Restore function names
        Object.keys(funcPH).forEach(function (ph) {
            s = s.replace(new RegExp(ph.replace(/[.*+?^${}()|[\]#\\]/g, '\\$&'), "g"), funcPH[ph]);
        });
        // Fix: function names shouldn't have * before ( — e.g. "log*(x)" → "log(x)"
        s = s.replace(/(sqrt|log|sin|cos|tan)\*\(/g, "$1(");
        return s;
    };

    Question.prototype.checkEquivSymbolic = function (studentLatex, expectedAnswer) {
        try {
            var studentExpr = this.latexToNerdamer(studentLatex);
            if (!studentExpr.trim()) return false;
            // Always convert expected answer through latexToNerdamer for consistent
            // implicit multiplication handling (e.g. "xy" → "x*y")
            var expectedNerdamer = this.latexToNerdamer(expectedAnswer);
            var diff = nerdamer("simplify((" + studentExpr + ")-(" + expectedNerdamer + "))");
            if (diff.toString() === "0") return true;
            // Numeric fallback: if no variables remain, evaluate and compare
            // Handles cases like log(100)/log(10) vs 2 where nerdamer has float rounding
            if (diff.variables().length === 0) {
                var numVal = parseFloat(diff.text("decimals"));
                return Math.abs(numVal) < 1e-9;
            }
            return false;
        } catch (e) { return false; }
    };

    Question.prototype.checkSetEquiv = function (studentLatex, expectedStr) {
        try {
            var self = this;
            var studentStr = self.latexToNerdamer(studentLatex);
            var studentParts = studentStr.split(",").map(function (s) { return s.trim(); }).filter(Boolean);
            var expectedParts = expectedStr.split(",").map(function (s) { return s.trim(); }).filter(Boolean);
            if (studentParts.length !== expectedParts.length) return false;

            var matched = {};
            for (var ei = 0; ei < expectedParts.length; ei++) {
                var found = false;
                for (var si = 0; si < studentParts.length; si++) {
                    if (matched[si]) continue;
                    try {
                        var diff = nerdamer("simplify((" + studentParts[si] + ")-(" + expectedParts[ei] + "))");
                        if (diff.toString() === "0") { matched[si] = true; found = true; break; }
                    } catch (e2) {}
                }
                if (!found) return false;
            }
            return true;
        } catch (e) { return false; }
    };

    Question.prototype.validateInput = function (studentLatex, inputSpec) {
        // LEGACY — DO NOT USE in new items or new versions of existing items.
        // setEquiv  → use equivSymbolic + constraints: { ordered: false }
        // factorFull → use equivSymbolic + constraints: { fullyFactored: "R" }
        // Kept only for backward compat with v1-v4 published question data.
        if (inputSpec.method === "setEquiv") return this.checkSetEquiv(studentLatex, inputSpec.answer);
        if (inputSpec.method === "factorFull") return this.checkFactorFull(studentLatex, inputSpec);

        // ── v5: Unified validation with constraints ──
        var self = this;
        var method = inputSpec.method || "equivSymbolic";
        var constraints = inputSpec.constraints || {};
        var studentNerd = this.latexToNerdamer(studentLatex);
        if (!studentNerd.trim()) return false;

        // Step 1: Check form constraints BEFORE equivalence
        if (constraints.form || constraints.lowestTerms || constraints.decimalPlaces !== undefined) {
            var formOk = this.checkFormConstraints(studentLatex, studentNerd, constraints);
            if (!formOk) return false;
        }

        // Step 2: Check excluded forms (equiLiteral match against each)
        if (constraints.exclude) {
            for (var ei = 0; ei < constraints.exclude.length; ei++) {
                if (this.checkEquiLiteral(studentLatex, constraints.exclude[ei])) return false;
            }
        }

        // Step 3: Equivalence check
        // Comma-separated answers default to unordered unless ordered:true
        var equivOk;
        var isCommaList = inputSpec.answer && inputSpec.answer.indexOf(",") >= 0;
        if (isCommaList && constraints.ordered !== true) {
            // Split both into parts, compare using the current method (permutation match)
            var studentParts = studentLatex.split(",").map(function (s) { return s.trim(); }).filter(Boolean);
            var expectedParts = inputSpec.answer.split(",").map(function (s) { return s.trim(); }).filter(Boolean);
            if (studentParts.length !== expectedParts.length) {
                equivOk = false;
            } else {
                var checkFn = method === "equiLiteral"
                    ? function (a, b) { return self.checkEquiLiteral(a, b); }
                    : function (a, b) { return self.checkEquivSymbolic(a, b); };
                var matched = {};
                equivOk = true;
                for (var ei = 0; ei < expectedParts.length; ei++) {
                    var found = false;
                    for (var si = 0; si < studentParts.length; si++) {
                        if (matched[si]) continue;
                        if (checkFn(studentParts[si], expectedParts[ei])) {
                            matched[si] = true; found = true; break;
                        }
                    }
                    if (!found) { equivOk = false; break; }
                }
            }
        } else if (method === "equiLiteral") {
            equivOk = this.checkEquiLiteral(studentLatex, inputSpec.answer);
        } else {
            equivOk = this.checkEquivSymbolic(studentLatex, inputSpec.answer);
        }
        if (!equivOk) return false;

        // Step 4: Post-equivalence constraints
        if (constraints.fullyFactored) {
            return this.checkFactorFull(studentLatex, {
                answer: inputSpec.answer,
                field: constraints.fullyFactored
            });
        }

        return true;
    };

    // ═══════════════════════════════════════════════════
    // v5: FORM CONSTRAINTS
    // ═══════════════════════════════════════════════════

    /**
     * Check that the student's answer satisfies form constraints.
     * Called BEFORE equivalence — rejects correct values in wrong form.
     */
    Question.prototype.checkFormConstraints = function (studentLatex, studentNerd, constraints) {
        var form = constraints.form;

        if (form === "decimal") {
            // Must look like a decimal number (digits, optional decimal point, optional sign)
            var cleaned = studentLatex.replace(/\\[,;:!]/g, "").replace(/\s/g, "").replace(/^[{]|[}]$/g, "");
            if (!/^-?\d+(\.\d+)?$/.test(cleaned)) return false;
            if (constraints.decimalPlaces !== undefined) {
                var dotIdx = cleaned.indexOf(".");
                if (dotIdx === -1) return constraints.decimalPlaces === 0;
                var places = cleaned.length - dotIdx - 1;
                return places === constraints.decimalPlaces;
            }
            return true;
        }

        if (form === "fraction") {
            // Must contain a fraction (via \frac or /)
            var hasFrac = /\\d?frac\{/.test(studentLatex) || /\//.test(studentLatex.replace(/\\[a-z]+/g, ""));
            if (!hasFrac) return false;
            if (constraints.lowestTerms) {
                return this.checkLowestTerms(studentNerd, studentLatex);
            }
            return true;
        }

        if (form === "interval") {
            // Must be interval notation: [a,b], (a,b), [a,b), (a,b], or unions thereof
            var cleaned2 = studentLatex.replace(/\\[,;:!]/g, "").replace(/\s/g, "");
            if (!/[\[\(].*,.*[\]\)]/.test(cleaned2)) return false;
            return true;
        }

        // lowestTerms without form:"fraction" — still check if it's a fraction in lowest terms
        if (constraints.lowestTerms) {
            return this.checkLowestTerms(studentNerd, studentLatex);
        }

        return true;
    };

    /**
     * Check if a fraction is in lowest terms.
     * Works on raw LaTeX to avoid nerdamer auto-simplifying (2/4 → 1/2).
     * Falls back to nerdamer for symbolic fractions.
     */
    Question.prototype.checkLowestTerms = function (nerdExpr, studentLatex) {
        // First try to extract from LaTeX \frac{num}{den}
        if (studentLatex) {
            var fracMatch = studentLatex.match(/\\d?frac\{([^{}]+)\}\{([^{}]+)\}/);
            if (fracMatch) {
                try {
                    var numVal = parseFloat(nerdamer(this.latexToNerdamer(fracMatch[1])).evaluate().text("decimals"));
                    var denVal = parseFloat(nerdamer(this.latexToNerdamer(fracMatch[2])).evaluate().text("decimals"));
                    numVal = Math.abs(Math.round(numVal));
                    denVal = Math.abs(Math.round(denVal));
                    if (denVal === 0) return false;
                    return this._gcd(numVal, denVal) === 1;
                } catch (e) {}
            }
        }
        // Fallback: try nerdamer numerator/denominator
        try {
            var num = nerdamer("numerator(" + nerdExpr + ")");
            var den = nerdamer("denominator(" + nerdExpr + ")");
            var nv = Math.abs(Math.round(parseFloat(num.evaluate().text("decimals"))));
            var dv = Math.abs(Math.round(parseFloat(den.evaluate().text("decimals"))));
            if (dv === 0) return false;
            return this._gcd(nv, dv) === 1;
        } catch (e) { return true; }
    };

    /** Greatest common divisor. */
    Question.prototype._gcd = function (a, b) {
        a = Math.abs(a); b = Math.abs(b);
        while (b) { var t = b; b = a % b; a = t; }
        return a;
    };

    // ═══════════════════════════════════════════════════
    // v5: EQUILITERAL — exact form match
    // ═══════════════════════════════════════════════════

    /**
     * Check if student's LaTeX matches the expected form exactly.
     * Normalizes whitespace and common LaTeX formatting differences.
     */
    Question.prototype.checkEquiLiteral = function (studentLatex, expected) {
        var normalize = function (s) {
            s = s.replace(/\\left/g, "").replace(/\\right/g, "");
            s = s.replace(/\s+/g, "");
            s = s.replace(/\{(\w)\}/g, "$1"); // {x} → x for single chars
            return s.trim().toLowerCase();
        };
        return normalize(studentLatex) === normalize(expected);
    };

    // ═══════════════════════════════════════════════════
    // v5: CONTAINER VALIDATION
    // ═══════════════════════════════════════════════════

    /**
     * Validate a response container — multiple boxes assembled into one expression.
     *
     * @param {object} container — { assembleTemplate, answer, method, constraints }
     * @param {string[]} boxValues — array of student LaTeX values from each box
     * @returns {boolean} whether the assembled expression is valid
     */
    Question.prototype.validateContainer = function (container, boxValues) {
        // Step 1: Assemble student expression from template
        var assembled = container.assembleTemplate;
        for (var i = 0; i < boxValues.length; i++) {
            var nerd = this.latexToNerdamer(boxValues[i]);
            assembled = assembled.replace("{{" + i + "}}", "(" + nerd + ")");
        }

        // Step 2: Detect equation/inequality in assembled expression
        var relMatch = assembled.match(/^(.+?)(=|<=|>=|<|>)(.+)$/);
        if (relMatch) {
            return this.validateContainerRelation(assembled, container, relMatch);
        }

        // Step 3: Plain expression — validate via inputSpec-style
        var syntheticSpec = {
            answer: container.answer,
            method: container.method || "equivSymbolic",
            constraints: container.constraints || {}
        };

        // For container validation, student input is already in nerdamer form
        return this.validateInputNerdamer(assembled, syntheticSpec);
    };

    /**
     * Validate a container that assembles into an equation/inequality.
     * e.g. "{{0}} = {{1}}" with answer "(x-2) = (2*x-1)"
     */
    Question.prototype.validateContainerRelation = function (assembled, container, relMatch) {
        var studentLHS = relMatch[1].trim();
        var sign = relMatch[2];
        var studentRHS = relMatch[3].trim();

        // Parse expected equation the same way
        var expectedMatch = container.answer.match(/^(.+?)(=|<=|>=|<|>)(.+)$/);
        if (!expectedMatch) return false;

        var expectedLHS = expectedMatch[1].trim();
        var expectedRHS = expectedMatch[3].trim();
        var expectedSign = expectedMatch[2];

        try {
            // Student: LHS - RHS, Expected: LHS - RHS
            var studentDiff = "(" + studentLHS + ")-(" + studentRHS + ")";
            var expectedDiff = "(" + expectedLHS + ")-(" + expectedRHS + ")";

            // Check if the two equations are equivalent:
            // studentDiff = k * expectedDiff for some nonzero constant k
            var directDiff = nerdamer("simplify(" + studentDiff + "-(" + expectedDiff + "))");
            if (directDiff.toString() === "0") {
                // Same orientation, same sign works
                return sign === expectedSign;
            }

            // Check if student swapped sides: studentDiff = -expectedDiff
            var swapDiff = nerdamer("simplify(" + studentDiff + "+(" + expectedDiff + "))");
            if (swapDiff.toString() === "0") {
                // Sides swapped — flip inequality sign if needed
                if (sign === "=") return expectedSign === "=";
                var flipMap = { "<": ">", ">": "<", "<=": ">=", ">=": "<=" };
                return sign === (flipMap[expectedSign] || expectedSign);
            }

            // Check proportional: studentDiff / expectedDiff = constant
            var ratio = nerdamer("simplify((" + studentDiff + ")/(" + expectedDiff + "))");
            if (ratio.variables().length === 0) {
                var ratioVal = parseFloat(ratio.text("decimals"));
                if (Math.abs(ratioVal) < 1e-9) return false;
                if (sign === "=" && expectedSign === "=") return true;
                // For inequalities: positive ratio preserves direction, negative flips
                if (ratioVal > 0) return sign === expectedSign;
                var flipMap2 = { "<": ">", ">": "<", "<=": ">=", ">=": "<=" };
                return sign === (flipMap2[expectedSign] || expectedSign);
            }

            return false;
        } catch (e) { return false; }
    };

    /**
     * Like validateInput but takes nerdamer-form expression directly (not LaTeX).
     * Used by container validation where assembly is already in nerdamer form.
     */
    Question.prototype.validateInputNerdamer = function (studentNerd, inputSpec) {
        var method = inputSpec.method || "equivSymbolic";
        var constraints = inputSpec.constraints || {};

        if (!studentNerd.trim()) return false;

        // Exclude check (excluded answers are in nerdamer form for containers)
        if (constraints.exclude) {
            for (var ei = 0; ei < constraints.exclude.length; ei++) {
                if (this._equivNerdamer(studentNerd, constraints.exclude[ei])) return false;
            }
        }

        // Equivalence
        var equivOk;
        if (method === "equiLiteral") {
            // For containers, equiLiteral compares nerdamer forms directly
            return studentNerd.replace(/\s/g, "") === inputSpec.answer.replace(/\s/g, "");
        }

        if (constraints.ordered === false) {
            // Split by comma, permutation match
            var studentParts = studentNerd.split(",").map(function (s) { return s.trim(); }).filter(Boolean);
            var expectedParts = inputSpec.answer.split(",").map(function (s) { return s.trim(); }).filter(Boolean);
            equivOk = this._permutationMatchNerdamer(studentParts, expectedParts);
        } else {
            equivOk = this._equivNerdamer(studentNerd, inputSpec.answer);
        }
        if (!equivOk) return false;

        // Post-equivalence constraints
        if (constraints.fullyFactored) {
            var factors = this.parseFactors(studentNerd);
            if (factors.length === 0) return false;
            for (var fi = 0; fi < factors.length; fi++) {
                try { if (nerdamer(factors[fi]).variables().length === 0) continue; } catch (e) {}
                if (!this.isIrreducible(factors[fi], constraints.fullyFactored)) return false;
            }
        }

        return true;
    };

    // ═══════════════════════════════════════════════════
    // v5: FACTORING VALIDATION — fully factored over ℤ/ℝ/ℂ
    // ═══════════════════════════════════════════════════

    /**
     * Parse a nerdamer-syntax expression into its top-level multiplicative factors.
     * E.g. "2*(x+2)*(x+3)" → ["2", "x+2", "x+3"]
     *       "(x-2)^2*(x+1)" → ["x-2", "x-2", "x+1"]  (exponents expanded)
     *       "-3*(x+1)" → ["-3", "x+1"]
     *
     * Works on the ASCII string (post latexToNerdamer conversion).
     */
    Question.prototype.parseFactors = function (expr) {
        expr = expr.trim();
        if (!expr) return [];

        // Normalize: remove outer parens if they wrap the whole expression
        while (expr.charAt(0) === "(" && this._findMatchingParen(expr, 0) === expr.length - 1) {
            expr = expr.substring(1, expr.length - 1).trim();
        }

        var factors = [];
        var i = 0;
        var len = expr.length;
        var current = "";
        var depth = 0;

        while (i < len) {
            var ch = expr.charAt(i);

            if (ch === "*" && depth === 0) {
                // Explicit multiplication — split here
                if (current.trim()) factors.push(current.trim());
                current = "";
                i++;
            } else if (ch === "(" && depth === 0 && current.trim() && !current.trim().match(/[+\-*/(^]$/)) {
                // Implicit multiplication at depth 0: "2(x+3)" or ")(x+3)"
                // Split before opening the paren group
                factors.push(current.trim());
                current = "";
                // Don't advance i — let the "(" be picked up next iteration
            } else if (ch === "(") {
                depth++;
                current += ch;
                i++;
            } else if (ch === ")") {
                depth--;
                current += ch;
                i++;
            } else {
                current += ch;
                i++;
            }
        }
        if (current.trim()) factors.push(current.trim());

        // Expand exponents: "x+2" with ^2 → two copies
        var expanded = [];
        for (var fi = 0; fi < factors.length; fi++) {
            var f = factors[fi];
            var expMatch = f.match(/^(.+)\^(\(?\d+\)?)$/);
            if (expMatch) {
                var base = expMatch[1];
                var exp = parseInt(expMatch[2].replace(/[()]/g, ""));
                // Strip outer parens from base
                if (base.charAt(0) === "(" && this._findMatchingParen(base, 0) === base.length - 1) {
                    base = base.substring(1, base.length - 1);
                }
                for (var k = 0; k < exp; k++) expanded.push(base);
            } else {
                // Strip outer parens from individual factor
                if (f.charAt(0) === "(" && this._findMatchingParen(f, 0) === f.length - 1) {
                    f = f.substring(1, f.length - 1);
                }
                expanded.push(f);
            }
        }

        return expanded;
    };

    /** Find the index of the closing paren matching the open paren at position pos. */
    Question.prototype._findMatchingParen = function (str, pos) {
        var depth = 0;
        for (var i = pos; i < str.length; i++) {
            if (str.charAt(i) === "(") depth++;
            else if (str.charAt(i) === ")") { depth--; if (depth === 0) return i; }
        }
        return -1;
    };

    /**
     * Get the degree of a polynomial expression in variable x.
     * Uses nerdamer to expand and check.
     */
    Question.prototype._polyDegree = function (expr, variable) {
        variable = variable || "x";
        try {
            var expanded = nerdamer("expand(" + expr + ")").toString();
            // Find highest power of the variable
            var degree = 0;
            // Check for x^n patterns
            var re = new RegExp(variable + "\\^\\(?(\\d+)\\)?", "g");
            var m;
            while ((m = re.exec(expanded)) !== null) {
                var d = parseInt(m[1]);
                if (d > degree) degree = d;
            }
            // Check for bare x (degree 1)
            if (degree === 0) {
                var reVar = new RegExp("[^a-zA-Z]" + variable + "(?![a-zA-Z0-9^])|^" + variable + "(?![a-zA-Z0-9^])");
                if (reVar.test(expanded)) degree = 1;
            }
            return degree;
        } catch (e) { return -1; }
    };

    /**
     * Extract polynomial coefficients [a, b, c] for ax^2+bx+c.
     * Uses evaluation at three points: f(0)=c, then solve for a and b.
     * Returns null if not a quadratic polynomial.
     */
    Question.prototype._quadCoeffs = function (expr, variable) {
        variable = variable || "x";
        try {
            var f0 = parseFloat(nerdamer(expr, { x: 0 }).evaluate().toString());
            var f1 = parseFloat(nerdamer(expr, { x: 1 }).evaluate().toString());
            var fm1 = parseFloat(nerdamer(expr, { x: -1 }).evaluate().toString());
            // For ax^2+bx+c: c=f(0), a=(f(1)+f(-1))/2-c, b=f(1)-a-c
            var c = f0;
            var a = (f1 + fm1) / 2 - c;
            var b = f1 - a - c;
            if (isNaN(a) || isNaN(b) || isNaN(c)) return null;
            return { a: a, b: b, c: c };
        } catch (e) { return null; }
    };

    /**
     * Check if a factor is irreducible over the specified field.
     * @param {string} factor — nerdamer expression string
     * @param {string} field — "integers", "reals", or "complex"
     * @returns {boolean} true if irreducible
     */
    Question.prototype.isIrreducible = function (factor, field) {
        var degree = this._polyDegree(factor);

        // Constants and linear factors are always irreducible
        if (degree <= 1) return true;

        if (field === "complex") {
            // Over ℂ: only linear factors are irreducible
            return false;
        }

        if (field === "reals") {
            // Over ℝ: irreducible if linear, or quadratic with negative discriminant
            if (degree === 2) {
                var coeffs = this._quadCoeffs(factor);
                if (!coeffs) return false;
                var disc = coeffs.b * coeffs.b - 4 * coeffs.a * coeffs.c;
                return disc < 0;
            }
            // Degree 3+: always reducible over ℝ (has at least one real root)
            return false;
        }

        // field === "integers" (factoring over ℤ, i.e. rational coefficients)
        if (degree === 2) {
            var coeffs2 = this._quadCoeffs(factor);
            if (!coeffs2) return false;
            var disc2 = coeffs2.b * coeffs2.b - 4 * coeffs2.a * coeffs2.c;
            // Irreducible over ℤ if discriminant is not a perfect square
            if (disc2 < 0) return true;
            var sqrtDisc = Math.sqrt(disc2);
            return Math.abs(sqrtDisc - Math.round(sqrtDisc)) > 1e-9;
        }

        if (degree === 3) {
            // Use rational root theorem: try ±(factors of constant)/(factors of leading coeff)
            try {
                // Extract leading coeff (a3) and constant (c3) via evaluation
                // For ax^3+bx^2+cx+d: d=f(0), and a3 via finite differences
                var f0_3 = parseFloat(nerdamer(factor, { x: 0 }).evaluate().toString());
                var f1_3 = parseFloat(nerdamer(factor, { x: 1 }).evaluate().toString());
                var fm1_3 = parseFloat(nerdamer(factor, { x: -1 }).evaluate().toString());
                var f2_3 = parseFloat(nerdamer(factor, { x: 2 }).evaluate().toString());
                // a3 = (f(2) - 3*f(1) + 3*f(-1) - f(-2)) ... simpler: use f(2)-3f(1)+3f(0)-f(-1) / 6?
                // Actually for ax^3+bx^2+cx+d: a3 = (f(2)-2f(1)+2f(-1)-f(-2))/12
                // Simpler: a3 = (f(2) - 3*f(1) + 3*f(0) - fm1_3) is not right.
                // Use: third finite difference / 6: Δ³f(0)/6 where Δf(n)=f(n+1)-f(n)
                var fm2_3 = parseFloat(nerdamer(factor, { x: -2 }).evaluate().toString());
                var a3 = Math.round((f2_3 - 3*f1_3 + 3*f0_3 - fm1_3) / 6);
                var c3 = Math.round(f0_3);
                if (c3 === 0) return false; // x=0 is a root
                var candidates = this._rationalRootCandidates(Math.round(a3), Math.round(c3));
                for (var ci = 0; ci < candidates.length; ci++) {
                    try {
                        var val = nerdamer(factor, { x: candidates[ci] }).evaluate().toString();
                        if (Math.abs(parseFloat(val)) < 1e-9) return false; // has a rational root
                    } catch (e) {}
                }
                return true;
            } catch (e) { return false; }
        }

        // Degree 4+: attempt nerdamer's factor() and see if it splits
        try {
            var factored = nerdamer("factor(" + factor + ")").toString();
            // If factor() returns something with *, it split — not irreducible
            // But we need to check at top level only
            var subFactors = this.parseFactors(factored);
            // Filter out pure numeric factors
            var nonConst = subFactors.filter(function (f) {
                try { return nerdamer(f).variables().length > 0; } catch (e) { return true; }
            });
            return nonConst.length <= 1;
        } catch (e) { return false; }
    };

    /** Generate rational root candidates ±(factors of c)/(factors of a). */
    Question.prototype._rationalRootCandidates = function (a, c) {
        a = Math.abs(a) || 1;
        c = Math.abs(c) || 1;
        var aFactors = this._intFactors(a);
        var cFactors = this._intFactors(c);
        var candidates = {};
        for (var i = 0; i < cFactors.length; i++) {
            for (var j = 0; j < aFactors.length; j++) {
                var r = cFactors[i] / aFactors[j];
                candidates[r] = true;
                candidates[-r] = true;
            }
        }
        return Object.keys(candidates).map(Number);
    };

    /** Integer factors of n. */
    Question.prototype._intFactors = function (n) {
        n = Math.abs(Math.round(n));
        if (n === 0) return [1];
        var result = [];
        for (var i = 1; i <= n; i++) {
            if (n % i === 0) result.push(i);
        }
        return result;
    };

    /**
     * Permutation-match two arrays of factor strings using symbolic equivalence.
     * Returns true if every expected factor is matched by exactly one student factor.
     */
    Question.prototype._permutationMatch = function (studentFactors, expectedFactors) {
        if (studentFactors.length !== expectedFactors.length) return false;
        var matched = {};
        for (var ei = 0; ei < expectedFactors.length; ei++) {
            var found = false;
            for (var si = 0; si < studentFactors.length; si++) {
                if (matched[si]) continue;
                if (this.checkEquivSymbolic(studentFactors[si], expectedFactors[ei])) {
                    // Note: checkEquivSymbolic expects (latex, nerdamer) but student factors
                    // are already in nerdamer form. Call nerdamer comparison directly.
                    matched[si] = true;
                    found = true;
                    break;
                }
            }
            if (!found) return false;
        }
        return true;
    };

    /** Direct nerdamer symbolic equivalence (both args in nerdamer syntax). */
    Question.prototype._equivNerdamer = function (a, b) {
        try {
            var diff = nerdamer("simplify((" + a + ")-(" + b + "))");
            return diff.toString() === "0";
        } catch (e) { return false; }
    };

    /**
     * Check factorFull: student's expression is fully factored over the specified field
     * and its factors match the expected factors (in any order).
     *
     * @param {string} studentLatex — raw LaTeX from MathQuill
     * @param {object} inputSpec — { answer: "2*(x+2)*(x+3)", method: "factorFull", field: "integers" }
     */
    Question.prototype.checkFactorFull = function (studentLatex, inputSpec) {
        try {
            var studentNerd = this.latexToNerdamer(studentLatex);
            if (!studentNerd.trim()) return false;

            var field = inputSpec.field || "integers";
            var expectedNerd = inputSpec.answer;

            // Step 1: Check that the expanded forms are equal (correct algebraic value)
            var studentExp = nerdamer("expand(" + studentNerd + ")").toString();
            var expectedExp = nerdamer("expand(" + expectedNerd + ")").toString();
            var diff = nerdamer("simplify((" + studentExp + ")-(" + expectedExp + "))");
            if (diff.toString() !== "0") return false;

            // Step 2: Parse student expression into factors
            var studentFactors = this.parseFactors(studentNerd);
            if (studentFactors.length === 0) return false;

            // Step 3: Check each factor is irreducible over the specified field
            for (var i = 0; i < studentFactors.length; i++) {
                var f = studentFactors[i];
                // Skip pure numeric constants (they're always "irreducible")
                try {
                    if (nerdamer(f).variables().length === 0) continue;
                } catch (e) {}
                if (!this.isIrreducible(f, field)) return false;
            }

            // Step 4: Permutation-match against expected factors
            var expectedFactors = this.parseFactors(expectedNerd);
            return this._permutationMatchNerdamer(studentFactors, expectedFactors);
        } catch (e) {
            return false;
        }
    };

    /**
     * Permutation-match factors where both arrays are in nerdamer syntax.
     */
    Question.prototype._permutationMatchNerdamer = function (studentFactors, expectedFactors) {
        if (studentFactors.length !== expectedFactors.length) return false;
        var self = this;
        var matched = {};
        for (var ei = 0; ei < expectedFactors.length; ei++) {
            var found = false;
            for (var si = 0; si < studentFactors.length; si++) {
                if (matched[si]) continue;
                if (self._equivNerdamer(studentFactors[si], expectedFactors[ei])) {
                    matched[si] = true;
                    found = true;
                    break;
                }
            }
            if (!found) return false;
        }
        return true;
    };

    /**
     * Grouped factorFull validation: multiple input boxes that together form
     * a factored expression. Factors can be entered in any order.
     *
     * Called when inputSpec has a "group" field. Collects all inputs in the group,
     * does permutation matching, and returns per-input correctness.
     *
     * @param {object} sec — section object
     * @param {object} row — row object containing inputs with group field
     * @returns {boolean[]} array of correct/incorrect per input
     */
    Question.prototype.checkFactorFullGrouped = function (sec, row) {
        var self = this;
        var groupId = null;
        var groupInputs = [];  // { idx, latex, expected, field }

        // Collect all inputs in this row that share the same factorFull group
        row.inputs.forEach(function (inp, ii) {
            if (inp.method === "factorFull" && inp.group) {
                if (!groupId) groupId = inp.group;
                if (inp.group === groupId) {
                    var field = self.mqFields[sec.id + "-" + row.id + "-" + ii];
                    var latex = field ? field.latex() : "";
                    groupInputs.push({
                        idx: ii,
                        nerdamer: self.latexToNerdamer(latex),
                        expected: inp.answer,
                        field: inp.field || "integers"
                    });
                }
            }
        });

        if (groupInputs.length === 0) return [];

        // Collect student and expected factor strings
        var studentFactors = groupInputs.map(function (g) { return g.nerdamer; });
        var expectedFactors = groupInputs.map(function (g) { return g.expected; });
        var field = groupInputs[0].field;

        // Check product equivalence first
        var studentProduct = studentFactors.join("*");
        var expectedProduct = expectedFactors.join("*");
        try {
            var diff = nerdamer("simplify(expand(" + studentProduct + ")-expand(" + expectedProduct + "))");
            if (diff.toString() !== "0") {
                // Product doesn't match — all wrong
                return groupInputs.map(function () { return false; });
            }
        } catch (e) {
            return groupInputs.map(function () { return false; });
        }

        // Check each student factor is irreducible
        for (var i = 0; i < studentFactors.length; i++) {
            try {
                if (nerdamer(studentFactors[i]).variables().length === 0) continue;
            } catch (e) {}
            if (!self.isIrreducible(studentFactors[i], field)) {
                return groupInputs.map(function () { return false; });
            }
        }

        // Permutation match: find which student factor matches which expected factor
        var results = groupInputs.map(function () { return false; });
        var matchedStudent = {};
        for (var ei = 0; ei < expectedFactors.length; ei++) {
            for (var si = 0; si < studentFactors.length; si++) {
                if (matchedStudent[si]) continue;
                if (self._equivNerdamer(studentFactors[si], expectedFactors[ei])) {
                    matchedStudent[si] = true;
                    results[si] = true;
                    break;
                }
            }
        }

        return results;
    };

    // ── Section builders ──
    Question.prototype.buildTextSection = function (sec) {
        var $div = $('<div id="' + this.uid + '-sec-' + sec.id + '"></div>');
        $div.append($("<div></div>").html(this._formatTextBlock(sec.content)));
        return $div;
    };

    Question.prototype.buildEquationTableSection = function (sec) {
        var self = this;
        var $wrapper = $('<div id="' + self.uid + '-sec-' + sec.id + '"></div>');

        var $table = $('<table class="req-eq-table"><tbody></tbody></table>');
        var $tbody = $table.find("tbody");

        self.completedRows[sec.id] = {};
        self.unlockedRows[sec.id] = {};

        sec.rows.forEach(function (row, ri) {
            var $tr = $('<tr class="req-eq-row locked" id="' + self.uid + '-row-' + sec.id + '-' + ri + '"></tr>');

            // Expression cell — nowrap to keep multi-fraction expressions on one line
            var $tdExpr = $('<td style="white-space:nowrap"></td>');
            if (row.inputs && row.inputs.length > 0) {
                // v6: single unified rendering path for all row types
                self.buildExpression($tdExpr, row, sec.id, ri);
            } else {
                $tdExpr.html("$" + (row.expression || "") + "$");
            }
            $tr.append($tdExpr);

            // Annotation cell
            var $tdAnn = $('<td class="req-annotation"></td>').text(row.annotation || '');
            self.renderKaTeX($tdAnn[0]);
            $tr.append($tdAnn);

            // Feedback cell
            $tr.append($('<td class="req-fb-cell" id="' + self.uid + '-fb-' + sec.id + '-' + ri + '"></td>'));

            $tbody.append($tr);

            // Button row
            if (row.inputs && row.inputs.length > 0) {
                var $trBtn = $('<tr class="req-eq-row locked" id="' + self.uid + '-rowbtn-' + sec.id + '-' + ri + '"></tr>');
                var $tdE = $("<td colspan='3'></td>");
                var $actions = $('<div class="req-actions"></div>');

                var $btn = $('<button class="req-check-btn">Next</button>');
                (function (secRef, rowIdx) {
                    $btn.on("click", function () { self.checkRowAnswer(secRef, rowIdx); });
                })(sec, ri);
                $actions.append($btn);

                var $fb = $('<span class="req-fb" id="' + self.uid + '-fbpill-' + sec.id + '-' + ri + '"></span>');
                $actions.append($fb);

                $tdE.append($actions);

                // Per-step hint (shown on failed Check, hidden on success)
                if (row.hint) {
                    var hintResult = self._renderHint(row.hint);
                    var $hintBox = $('<div class="req-hint-box ' + hintResult.modeClass + '" id="' + self.uid + '-hint-' + sec.id + '-' + ri + '"></div>').html(hintResult.html);
                    $tdE.append($hintBox);
                }

                $trBtn.append($tdE);
                $tbody.append($trBtn);
            }
        });

        $wrapper.append($table);
        return $wrapper;
    };

    Question.prototype.buildTextWithInputSection = function (sec) {
        var self = this;
        var $wrapper = $('<div class="req-twi-flex" id="' + self.uid + '-sec-' + sec.id + '"></div>');

        // Left: content area
        var $content = $('<div style="flex:1"></div>');

        var tpl = self._extractDNFromMath(
            self._stripContainerDelims(sec.template || ""),
            sec.inputs
        );
        var $p = $("<div style='font-size:15px;line-height:1.7;margin:0 0 10px;'></div>");

        // Check if any {{N}} sits inside a $...$ or $$...$$ math zone.
        // If so, use marker-based rendering so KaTeX sees complete LaTeX.
        var hasMathInputs = false;
        var mathRe = /\$\$[\s\S]*?\$\$|\$[^$]*?\$/g;
        var mm;
        while ((mm = mathRe.exec(tpl)) !== null) {
            if (/\{\{\d+\}\}/.test(mm[0])) { hasMathInputs = true; break; }
        }

        if (hasMathInputs) {
            // v7: KaTeX-with-markers — replace {{N}} with \htmlId placeholders
            // inside math zones, let KaTeX handle all layout natively
            var prefix = "REQPH" + sec.id.replace(/[^a-zA-Z0-9]/g, "") + "X";

            var marked = tpl.replace(/(\$\$[\s\S]*?\$\$|\$[^$]*?\$)/g, function (mathBlock) {
                var b = mathBlock.replace(/\{\{(\d+)\}\}/g, function (m, n) {
                    return "\\htmlId{" + prefix + n + "}{\\boxed{\\strut\\phantom{x}}}";
                });
                // Promote \frac → \dfrac (not \dfrac) so frac-line stays visible
                if (b.indexOf("\\htmlId{") !== -1) b = b.replace(/(^|[^d])\\frac\{/g, "$1\\dfrac{");
                return b;
            });
            // Replace remaining {{N}} (in prose) with HTML placeholder spans
            marked = marked.replace(/\{\{(\d+)\}\}/g, function (m, n) {
                return '<span id="' + prefix + n + '"></span>';
            });

            $p.html(self._formatTextBlock(marked));
            self.renderKaTeX($p[0]);

            // Swap all markers for MQ/dropdown input fields
            var mkId = function (idx, kind) {
                return self.uid + "-" + kind + "-" + sec.id + "-" + idx;
            };
            self._replaceMarkers($p[0], prefix, sec.inputs, mkId);
        } else {
            // Simple split — no {{N}} inside math zones
            // Use placeholder spans so HTML structure (e.g. <ul><li>) stays intact
            var phPrefix = self.uid + "-sph-" + sec.id + "-";
            var htmlWithPh = self._formatTextBlock(tpl).replace(/\{\{(\d+)\}\}/g, function (m, n) {
                return '<span id="' + phPrefix + n + '" data-input-idx="' + n + '"></span>';
            });
            $p.html(htmlWithPh);
            self.renderKaTeX($p[0]);
            $p.find('[data-input-idx]').each(function () {
                var $ph = $(this);
                var inputIdx = parseInt($ph.attr('data-input-idx'));
                var inp = sec.inputs[inputIdx];
                if (inp && inp.type === "dropdown") {
                    var $dd = self._buildDropdown(self.uid + '-dd-' + sec.id + '-' + inputIdx, inp.options || [], function () { self._fireChanged(); });
                    $ph.replaceWith($dd);
                } else {
                    var $mqSpan = $('<span class="mq-slot" id="' + self.uid + '-mq-' + sec.id + '-' + inputIdx + '" style="display:inline-block;min-width:70px;vertical-align:middle;"></span>');
                    $ph.replaceWith($mqSpan);
                }
            });
        }

        $content.append($p);

        // Actions row — only if there are actual inputs to check
        var hasInputs = sec.inputs && sec.inputs.length > 0;
        if (hasInputs) {
            var $actions = $('<div class="req-actions" id="' + self.uid + '-actions-' + sec.id + '"></div>');
            var $btn = $('<button class="req-check-btn">Next</button>');
            (function (secRef) {
                $btn.on("click", function () { self.checkSectionAnswer(secRef); });
            })(sec);
            $actions.append($btn);
            $actions.append($('<span class="req-fb" id="' + self.uid + '-fbpill-' + sec.id + '"></span>'));
            $content.append($actions);

            // Per-step hint (shown on failed Next, hidden on success)
            if (sec.hint) {
                var hintResult = self._renderHint(sec.hint);
                var $hintBox = $('<div class="req-hint-box ' + hintResult.modeClass + '" id="' + self.uid + '-hint-' + sec.id + '"></div>').html(hintResult.html);
                $content.append($hintBox);
            }
        }

        $wrapper.append($content);

        // Right: tick cell (only for sections with inputs)
        if (hasInputs) {
            var $tick = $('<div id="' + self.uid + '-tick-' + sec.id + '" style="width:28px;text-align:center;padding-top:6px;visibility:hidden;"></div>');
            $tick.html('<span style="color:#3a9447;font-size:16px;">&#10003;</span>');
            $wrapper.append($tick);
        }

        self.renderKaTeX($wrapper[0]);

        // Init MathQuill fields
        requestAnimationFrame(function () {
            sec.inputs.forEach(function (inp, inputIdx) {
                if (inp.type === "dropdown") return;
                var slot = document.getElementById(self.uid + "-mq-" + sec.id + "-" + inputIdx);
                if (slot) {
                    var field = self.MQ.MathField(slot, {
                        spaceBehavesLikeTab: true,
                        handlers: {
                            enter: function () { self.checkSectionAnswer(sec); },
                            edit: function () { self._fireChanged(); }
                        }
                    });
                    self.mqFields[sec.id + "-" + inputIdx] = field;
                    self.setupKeypadForField(field, slot);
                }
            });
        });

        return $wrapper;
    };

    // ══════════════════════════════════════════════════════════════════
    // v6: UNIFIED EXPRESSION BUILDER
    // Replaces both buildTemplateExpression and buildMixedContentRow.
    // Principle: never put interactive inputs inside KaTeX.
    // ══════════════════════════════════════════════════════════════════

    /**
     * Normalize a row's expression to content format.
     * template: "= \frac{{{0}}}{{{1}}}"  →  content: "$= \frac{{{0}}}{{{1}}}$"
     * content:  "$= \dfrac{{{0}}}{{{1}}}$, $x \neq {{2}}$"  →  unchanged
     */
    Question.prototype._normalizeToContent = function (row) {
        if (row.content) return row.content;
        if (row.template) return "$" + row.template + "$";
        return "";
    };

    /**
     * Build any equation-table row expression (template or content format).
     * Normalizes everything to content format, then uses a single rendering path.
     */
    Question.prototype.buildExpression = function ($container, row, secId, rowIdx) {
        var self = this;

        // Legacy htmlTemplate path (pre-v5 items with pre-parsed sup/sub)
        if (row.htmlTemplate) {
            self._buildHtmlTemplateLegacy($container, row, secId, rowIdx);
            return;
        }

        // v6 unified path: normalize to content format
        var tpl = self._extractDNFromMath(
            self._stripContainerDelims(self._normalizeToContent(row)),
            row.inputs
        );
        var prefix = "REQV7" + secId.replace(/[^a-zA-Z0-9]/g, "") + "R" + rowIdx + "X";

        var mkId = function (idx, kind) {
            return self.uid + "-" + kind + "-" + secId + "-" + rowIdx + "-" + idx;
        };

        // For container rows on teacher side, wrap content in a visual grouping span
        var useContainerWrap = row.container && self.isTeacher && !row.containers;

        // ── v7: KaTeX-with-markers (single path for all structures) ──
        // Replace {{N}} with \htmlId markers inside math zones, render via KaTeX,
        // then swap markers for MQ/dropdown fields. KaTeX handles all layout
        // (fractions, superscripts, subscripts, \left/\right, \sqrt, etc.)

        var $wrapper = $('<span style="display:inline-flex;align-items:center;gap:2px;"></span>');
        var $target = $wrapper;

        if (useContainerWrap) {
            var $cWrap = $('<span class="req-container-wrap" id="' + self.uid + '-cwrap-' + secId + '-' + rowIdx + '"></span>');
            $wrapper.append($cWrap);
            $target = $cWrap;
        }

        // Inside math zones ($...$, $$...$$): replace {{N}} with \htmlId placeholder boxes
        var marked = tpl.replace(/(\$\$[\s\S]*?\$\$|\$[^$]*?\$)/g, function (mathBlock) {
            var b = mathBlock.replace(/\{\{(\d+)\}\}/g, function (m, n) {
                return "\\htmlId{" + prefix + n + "}{\\boxed{\\strut\\phantom{x}}}";
            });
            // Promote \frac → \dfrac (not \dfrac) so frac-line stays visible
            if (b.indexOf("\\htmlId{") !== -1) b = b.replace(/(^|[^d])\\frac\{/g, "$1\\dfrac{");
            return b;
        });
        // In prose zones: replace remaining {{N}} with HTML span placeholders
        marked = marked.replace(/\{\{(\d+)\}\}/g, function (m, n) {
            return '<span id="' + prefix + n + '"></span>';
        });

        var $sp = $("<span></span>").html(self._formatTextBlock(marked));
        self.renderKaTeX($sp[0]);
        $target.append($sp);

        $container.empty().append($wrapper);

        // Swap all \htmlId markers for MQ/dropdown input fields
        self._replaceMarkers($container[0], prefix, row.inputs, mkId);

        // Init MathQuill fields
        requestAnimationFrame(function () {
            row.inputs.forEach(function (inp, inputIdx) {
                if (inp.type === "dropdown") return;
                var slot = document.getElementById(self.uid + "-mq-" + secId + "-" + rowIdx + "-" + inputIdx);
                if (slot) {
                    var field = self.MQ.MathField(slot, {
                        spaceBehavesLikeTab: true,
                        handlers: {
                            enter: function () {
                                var sec = self.findSectionById(secId);
                                if (sec) self.checkRowAnswer(sec, rowIdx);
                            },
                            edit: function () { self._fireChanged(); }
                        }
                    });
                    self.mqFields[secId + "-" + rowIdx + "-" + inputIdx] = field;
                    self.setupKeypadForField(field, slot);
                }
            });

            // Teacher side: schedule container overlay borders (must wait for teacher mode
            // to unlock rows — _applyTeacherLiveMode runs at 200ms, so defer to 400ms)
            if (row.containers && row.containers.length > 0 && self.isTeacher) {
                (function (containers, secIdCap, rowIdxCap, $containerCap) {
                    setTimeout(function () {
                        var $exprCell = $containerCap.closest("td");
                        if ($exprCell.length) $exprCell.css("position", "relative");

                        containers.forEach(function (ctr, ci) {
                            if (!ctr.inputIndices || ctr.inputIndices.length === 0) return;
                            var refEl = $exprCell.length ? $exprCell[0] : $containerCap[0];
                            var refRect = refEl.getBoundingClientRect();
                            var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
                            ctr.inputIndices.forEach(function (idx) {
                                var slotId = self.uid + "-mq-" + secIdCap + "-" + rowIdxCap + "-" + idx;
                                var slot = document.getElementById(slotId);
                                if (!slot) return;
                                var r = slot.getBoundingClientRect();
                                if (r.left < minX) minX = r.left;
                                if (r.top < minY) minY = r.top;
                                if (r.right > maxX) maxX = r.right;
                                if (r.bottom > maxY) maxY = r.bottom;
                            });
                            if (minX === Infinity) return;
                            // Detect context: if any slot is inside a fraction, use tight vertical padding
                            var inFraction = false;
                            ctr.inputIndices.forEach(function (idx) {
                                var slotId = self.uid + "-mq-" + secIdCap + "-" + rowIdxCap + "-" + idx;
                                var slot = document.getElementById(slotId);
                                if (slot && $(slot).closest(".mfrac").length) inFraction = true;
                            });
                            var padX = inFraction ? 8 : 6;
                            var padY = inFraction ? 3 : 8;
                            var $overlay = $('<div class="req-container-wrap" id="' + self.uid + '-cwrap-' + secIdCap + '-' + rowIdxCap + '-' + ci + '"></div>');
                            $overlay.css({
                                position: "absolute",
                                left: (minX - refRect.left - padX) + "px",
                                top: (minY - refRect.top - padY) + "px",
                                width: (maxX - minX + 2 * padX) + "px",
                                height: (maxY - minY + 2 * padY) + "px",
                                pointerEvents: "none",
                                background: "transparent",
                                padding: "0",
                                display: "block",
                                border: "1.5px solid #ccc",
                                borderRadius: "5px",
                                zIndex: "1"
                            });
                            $(refEl).append($overlay);
                        });
                    }, 500);
                })(row.containers, secId, rowIdx, $container);
            }
        });
    };

    /**
     * Legacy htmlTemplate rendering (backward compat with pre-v5 items).
     * Kept separate to avoid polluting the unified path.
     */
    Question.prototype._buildHtmlTemplateLegacy = function ($container, row, secId, rowIdx) {
        var self = this;
        var $wrapper = $('<span></span>');

        row.htmlTemplate.forEach(function (part) {
            if (part.sup !== undefined && part.inputIdx !== undefined) {
                var $base = $("<span></span>").css("vertical-align", "middle").html("$" + part.text + "$");
                $wrapper.append($base);
                var $sup = $("<sup></sup>").css({ position: "relative", top: "-0.8em", fontSize: "0.7em" });
                if (part.supPrefix) {
                    var $pre = $("<span></span>").css("font-size", "13px");
                    $pre.html(part.supPrefix.indexOf("\\") >= 0 ? "$" + part.supPrefix + "$" : part.supPrefix);
                    $sup.append($pre);
                }
                var $mqSpan = $('<span class="mq-slot req-mq-sup" id="' + self.uid + '-mq-' + secId + '-' + rowIdx + '-' + part.inputIdx + '" style="display:inline-block;min-width:40px;"></span>');
                $sup.append($mqSpan);
                if (part.supSuffix) {
                    var $suf = $("<span></span>").css("font-size", "13px");
                    $suf.html(part.supSuffix.indexOf("\\") >= 0 ? "$" + part.supSuffix + "$" : part.supSuffix);
                    $sup.append($suf);
                }
                $wrapper.append($sup);
            } else if (part.sub !== undefined && part.inputIdx !== undefined) {
                var $baseSub = $("<span></span>").css("vertical-align", "middle").html("$" + part.text + "$");
                $wrapper.append($baseSub);
                var $sub = $("<sub></sub>").css({ position: "relative", top: "0.3em" });
                if (part.subPrefix) {
                    var $preSub = $("<span></span>").css("font-size", "13px");
                    $preSub.html(part.subPrefix.indexOf("\\") >= 0 ? "$" + part.subPrefix + "$" : part.subPrefix);
                    $sub.append($preSub);
                }
                var $mqSpanSub = $('<span class="mq-slot req-mq-sub" id="' + self.uid + '-mq-' + secId + '-' + rowIdx + '-' + part.inputIdx + '" style="display:inline-block;min-width:30px;"></span>');
                $sub.append($mqSpanSub);
                if (part.subSuffix) {
                    var $sufSub = $("<span></span>").css("font-size", "13px");
                    $sufSub.html(part.subSuffix.indexOf("\\") >= 0 ? "$" + part.subSuffix + "$" : part.subSuffix);
                    $sub.append($sufSub);
                }
                $wrapper.append($sub);
            } else if (part.inputIdx !== undefined) {
                if (part.text) {
                    $wrapper.append($("<span></span>").css("vertical-align", "middle").html("$" + part.text + "$"));
                }
                if (part.prefix) {
                    $wrapper.append($("<span></span>").css("vertical-align", "middle").text(part.prefix));
                }
                var $mqSpan2 = $('<span class="mq-slot" id="' + self.uid + '-mq-' + secId + '-' + rowIdx + '-' + part.inputIdx + '" style="display:inline-block;min-width:60px;vertical-align:middle;"></span>');
                $wrapper.append($mqSpan2);
                if (part.suffix) {
                    var $suf2 = $("<span></span>").css("vertical-align", "middle");
                    $suf2.html(part.suffix.indexOf("\\") >= 0 ? "$" + part.suffix + "$" : part.suffix);
                    $wrapper.append($suf2);
                }
            } else {
                var hasLatex = part.text.indexOf("\\") >= 0 || part.text.indexOf("^") >= 0 || part.text.indexOf("_") >= 0;
                $wrapper.append($("<span></span>").css("vertical-align", "middle").html(hasLatex ? "$" + part.text + "$" : part.text));
            }
        });

        $container.append($wrapper);
        self.renderKaTeX($container[0]);

        // Init MathQuill fields
        requestAnimationFrame(function () {
            row.inputs.forEach(function (inp, inputIdx) {
                if (inp.type === "dropdown") return;
                var slot = document.getElementById(self.uid + "-mq-" + secId + "-" + rowIdx + "-" + inputIdx);
                if (slot) {
                    var field = self.MQ.MathField(slot, {
                        spaceBehavesLikeTab: true,
                        handlers: {
                            enter: function () {
                                var sec = self.findSectionById(secId);
                                if (sec) self.checkRowAnswer(sec, rowIdx);
                            },
                            edit: function () { self._fireChanged(); }
                        }
                    });
                    self.mqFields[secId + "-" + rowIdx + "-" + inputIdx] = field;
                    self.setupKeypadForField(field, slot);
                }
            });
        });
    };

    // ── REMOVED: buildMixedContentRow and buildTemplateExpression ──
    // Both replaced by buildExpression (v6 unified renderer) above.
    // _buildHtmlTemplateLegacy preserved for backward compat with pre-v5 htmlTemplate items.

    // ── Section unlocking ──
    Question.prototype.findSectionById = function (secId) {
        var sections = this.question.sections || [];
        for (var i = 0; i < sections.length; i++) {
            if (sections[i].id === secId) return sections[i];
        }
        return null;
    };

    Question.prototype.getSectionIndex = function (secId) {
        var sections = this.question.sections || [];
        for (var i = 0; i < sections.length; i++) {
            if (sections[i].id === secId) return i;
        }
        return -1;
    };

    Question.prototype.unlockSection = function (idx) {
        var self = this;
        var sections = self.question.sections || [];
        if (idx >= sections.length) {
            // All done
            $("#" + self.uid + "-done").show();
            self.events.trigger("changed", self.getResponse());
            return;
        }

        var sec = sections[idx];

        // Unlock the section's parent step wrapper (scaffold block) if locked
        var $el = $("#" + self.uid + "-sec-" + sec.id);
        $el.closest(".req-scaffold-block.req-section-locked").removeClass("req-section-locked");

        // Unlock the section itself
        $el.removeClass("req-section-locked");

        // TWI with no inputs behaves like a text section — auto-complete
        var isTWINoInputs = sec.type === "text-with-input" && (!sec.inputs || sec.inputs.length === 0);

        if (sec.type === "text" || isTWINoInputs) {
            self.completedSections[sec.id] = true;
            requestAnimationFrame(function () { self.unlockSection(idx + 1); });
        } else if (sec.type === "equation-table") {
            self.initTableRows(sec);
        } else if (sec.type === "text-with-input") {
            requestAnimationFrame(function () {
                var hasOnlyDropdowns = true;
                for (var i = 0; i < sec.inputs.length; i++) {
                    if (sec.inputs[i].type !== "dropdown") { hasOnlyDropdowns = false; break; }
                }
                if (hasOnlyDropdowns) {
                    var dd = document.getElementById(self.uid + "-dd-" + sec.id + "-0");
                    if (dd) dd.focus();
                }
            });
        }
    };

    Question.prototype.initTableRows = function (sec) {
        var self = this;
        if (!self.unlockedRows[sec.id]) self.unlockedRows[sec.id] = {};
        if (!self.completedRows[sec.id]) self.completedRows[sec.id] = {};

        for (var ri = 0; ri < sec.rows.length; ri++) {
            var row = sec.rows[ri];
            if (!row.inputs || row.inputs.length === 0) {
                self.unlockedRows[sec.id][ri] = true;
                self.completedRows[sec.id][ri] = true;
            } else {
                self.unlockedRows[sec.id][ri] = true;
                break;
            }
        }
        self.updateRowStates(sec);
    };

    Question.prototype.updateRowStates = function (sec) {
        var self = this;
        sec.rows.forEach(function (row, ri) {
            var $tr = $("#" + self.uid + "-row-" + sec.id + "-" + ri);
            var $trBtn = $("#" + self.uid + "-rowbtn-" + sec.id + "-" + ri);
            if (!$tr.length) return;

            $tr.removeClass("locked active completed");
            $trBtn.removeClass("locked active completed");

            if (self.completedRows[sec.id] && self.completedRows[sec.id][ri]) {
                $tr.addClass("completed");
                $trBtn.addClass("completed");
            } else if (self.unlockedRows[sec.id] && self.unlockedRows[sec.id][ri]) {
                $tr.addClass("active");
                $trBtn.addClass("active");
            } else {
                $tr.addClass("locked");
                $trBtn.addClass("locked");
            }
        });
    };

    // ── Row validation (equation table) ──
    Question.prototype.checkRowAnswer = function (sec, rowIdx) {
        var self = this;
        if (self._disabled) return;
        var row = sec.rows[rowIdx];
        var allCorrect = true;

        if (row.containers && row.containers.length > 0) {
            // ── v5: Multi-container validation — each container validates a subset of inputs ──
            // Build a set of input indices that belong to any container
            var containerInputs = {};
            row.containers.forEach(function (ctr) {
                if (!ctr.inputIndices) return;
                ctr.inputIndices.forEach(function (idx) { containerInputs[idx] = true; });
            });

            // Validate each container
            row.containers.forEach(function (ctr) {
                if (!ctr.inputIndices) return;
                var boxValues = [];
                var boxOk = true;
                ctr.inputIndices.forEach(function (idx) {
                    var field = self.mqFields[sec.id + "-" + rowIdx + "-" + idx];
                    if (!field) { boxOk = false; return; }
                    boxValues.push(field.latex());
                });
                if (!boxOk || boxValues.length !== ctr.inputIndices.length) {
                    allCorrect = false;
                    return;
                }
                var correct = self.validateContainer(ctr, boxValues);
                if (!correct) allCorrect = false;
                // Color container boxes
                ctr.inputIndices.forEach(function (idx) {
                    var slot = document.getElementById(self.uid + "-mq-" + sec.id + "-" + rowIdx + "-" + idx);
                    if (slot) { $(slot).removeClass("correct incorrect").addClass(correct ? "correct" : "incorrect"); }
                });
            });

            // Validate individual inputs not in any container
            row.inputs.forEach(function (inp, ii) {
                if (containerInputs[ii]) return; // already handled by container
                var field = self.mqFields[sec.id + "-" + rowIdx + "-" + ii];
                if (!field) { allCorrect = false; return; }
                var correct = self.validateInput(field.latex(), inp);
                var slot = document.getElementById(self.uid + "-mq-" + sec.id + "-" + rowIdx + "-" + ii);
                if (slot) { $(slot).removeClass("correct incorrect").addClass(correct ? "correct" : "incorrect"); }
                if (!correct) allCorrect = false;
            });
        } else if (row.container) {
            // ── Legacy single-container (backward compat) ──
            var boxValues = [];
            for (var bi = 0; bi < row.inputs.length; bi++) {
                var field = self.mqFields[sec.id + "-" + rowIdx + "-" + bi];
                if (!field) { allCorrect = false; break; }
                boxValues.push(field.latex());
            }
            if (boxValues.length === row.inputs.length) {
                allCorrect = self.validateContainer(row.container, boxValues);
            }
            if (self.isTeacher) {
                var $cWrap = $("#" + self.uid + "-cwrap-" + sec.id + "-" + rowIdx);
                $cWrap.removeClass("req-cwrap-correct req-cwrap-incorrect")
                    .addClass(allCorrect ? "req-cwrap-correct" : "req-cwrap-incorrect");
                $cWrap.find(".req-cwrap-tick").remove();
                $cWrap.append(allCorrect
                    ? '<span class="req-cwrap-tick" style="color:#3a9447;font-size:14px;margin-left:6px;vertical-align:middle;">&#10003;</span>'
                    : '<span class="req-cwrap-tick" style="color:#e8883a;font-size:14px;margin-left:6px;vertical-align:middle;">&#10007;</span>');
            } else {
                for (var ci = 0; ci < row.inputs.length; ci++) {
                    var slot = document.getElementById(self.uid + "-mq-" + sec.id + "-" + rowIdx + "-" + ci);
                    if (slot) { $(slot).removeClass("correct incorrect").addClass(allCorrect ? "correct" : "incorrect"); }
                }
            }
        } else if (row.validation === "equivEquation" && row.inputs.length === 2) {
            // Legacy equivEquation (backward compat with pre-v5 question data)
            var fieldL = self.mqFields[sec.id + "-" + rowIdx + "-0"];
            var fieldR = self.mqFields[sec.id + "-" + rowIdx + "-1"];
            if (!fieldL || !fieldR) return;

            var sL = self.latexToNerdamer(fieldL.latex());
            var sR = self.latexToNerdamer(fieldR.latex());
            try {
                if (!sL.trim() || !sR.trim()) { allCorrect = false; }
                else {
                    var sDiff = "((" + sL + ")-(" + sR + "))";
                    var eDiff = "((" + row.inputs[0].answer + ")-(" + row.inputs[1].answer + "))";
                    var direct = nerdamer("simplify(" + sDiff + " - " + eDiff + ")");
                    if (direct.toString() !== "0") {
                        var ratio = nerdamer("simplify(" + sDiff + " / " + eDiff + ")");
                        allCorrect = ratio.toString() !== "0" && ratio.variables().length === 0;
                        if (!allCorrect) {
                            var ratio2 = nerdamer("simplify(expand(" + sDiff + ") / expand(" + eDiff + "))");
                            allCorrect = ratio2.variables().length === 0 && ratio2.toString() !== "0";
                        }
                    }
                }
            } catch (e) { allCorrect = false; }

            [0, 1].forEach(function (ii) {
                var slot = document.getElementById(self.uid + "-mq-" + sec.id + "-" + rowIdx + "-" + ii);
                if (slot) { $(slot).removeClass("correct incorrect").addClass(allCorrect ? "correct" : "incorrect"); }
            });
        } else {
            row.inputs.forEach(function (inp, ii) {
                var field = self.mqFields[sec.id + "-" + rowIdx + "-" + ii];
                if (!field) return;
                var correct = self.validateInput(field.latex(), inp);

                var slot = document.getElementById(self.uid + "-mq-" + sec.id + "-" + rowIdx + "-" + ii);
                if (slot) { $(slot).removeClass("correct incorrect").addClass(correct ? "correct" : "incorrect"); }

                if (!correct) allCorrect = false;
            });
        }

        // Feedback pill
        var $fbPill = $("#" + self.uid + "-fbpill-" + sec.id + "-" + rowIdx);
        $fbPill.attr("class", "req-fb " + (allCorrect ? "correct" : "wrong")).text(allCorrect ? "Correct!" : "Try again");

        // Per-step hint: show on failure, hide on success
        var $hintBox = $("#" + self.uid + "-hint-" + sec.id + "-" + rowIdx);
        if ($hintBox.length) {
            if (allCorrect) {
                $hintBox.removeClass("visible");
            } else {
                $hintBox.addClass("visible");
            }
        }

        // Tick in feedback cell
        var $fb = $("#" + self.uid + "-fb-" + sec.id + "-" + rowIdx);
        $fb.html(allCorrect
            ? '<span style="color:#3a9447;font-size:16px;">&#10003;</span>'
            : '<span style="color:#e8883a;font-size:16px;">&#10007;</span>');

        if (allCorrect) {
            self.completedRows[sec.id][rowIdx] = true;

            // Disable inputs
            row.inputs.forEach(function (inp, ii) {
                var slot = document.getElementById(self.uid + "-mq-" + sec.id + "-" + rowIdx + "-" + ii);
                if (slot) slot.style.pointerEvents = "none";
            });

            // Hide button row
            $("#" + self.uid + "-rowbtn-" + sec.id + "-" + rowIdx).hide();

            // Unlock next row or complete section
            var nextRow = rowIdx + 1;
            if (nextRow < sec.rows.length) {
                var ri = nextRow;
                while (ri < sec.rows.length) {
                    var r = sec.rows[ri];
                    if (!r.inputs || r.inputs.length === 0) {
                        self.unlockedRows[sec.id][ri] = true;
                        self.completedRows[sec.id][ri] = true;
                        ri++;
                    } else {
                        self.unlockedRows[sec.id][ri] = true;
                        break;
                    }
                }
                self.updateRowStates(sec);
                requestAnimationFrame(function () {
                    for (var r = nextRow; r < sec.rows.length; r++) {
                        var f = self.mqFields[sec.id + "-" + r + "-0"];
                        if (f) { f.focus(); break; }
                    }
                });
            } else {
                self.completedSections[sec.id] = true;
                var secIdx = self.getSectionIndex(sec.id);
                self.unlockSection(secIdx + 1);
            }
        }

        self.updateRowStates(sec);
        self.events.trigger("changed", self.getResponse());
    };

    // ── Section validation (text-with-input) ──
    Question.prototype.checkSectionAnswer = function (sec) {
        var self = this;
        if (self._disabled) return;
        var allCorrect = true;

        sec.inputs.forEach(function (inp, ii) {
            if (inp.type === "dropdown") {
                var dd = document.getElementById(self.uid + "-dd-" + sec.id + "-" + ii);
                if (!dd) return;
                var correct = dd.getValue() === inp.answer;
                $(dd).removeClass("correct incorrect").addClass(correct ? "correct" : "incorrect");
                if (!correct) allCorrect = false;
            } else {
                var field = self.mqFields[sec.id + "-" + ii];
                if (!field) return;
                var correct2 = self.validateInput(field.latex(), inp);
                var slot = document.getElementById(self.uid + "-mq-" + sec.id + "-" + ii);
                if (slot) { $(slot).removeClass("correct incorrect").addClass(correct2 ? "correct" : "incorrect"); }
                if (!correct2) allCorrect = false;
            }
        });

        var $fbPill = $("#" + self.uid + "-fbpill-" + sec.id);
        $fbPill.attr("class", "req-fb " + (allCorrect ? "correct" : "wrong")).text(allCorrect ? "Correct!" : "Try again");

        // Per-step hint: show on failure, hide on success
        var $hintBox = $("#" + self.uid + "-hint-" + sec.id);
        if ($hintBox.length) {
            if (allCorrect) {
                $hintBox.removeClass("visible");
            } else {
                $hintBox.addClass("visible");
            }
        }

        if (allCorrect) {
            self.completedSections[sec.id] = true;

            // Hide actions, show tick on right edge
            $("#" + self.uid + "-actions-" + sec.id).hide();
            $("#" + self.uid + "-tick-" + sec.id).css("visibility", "visible");

            // Disable inputs
            sec.inputs.forEach(function (inp, ii) {
                if (inp.type === "dropdown") {
                    var dd = document.getElementById(self.uid + "-dd-" + sec.id + "-" + ii);
                    if (dd && dd.setDisabled) dd.setDisabled(true);
                } else {
                    var slot = document.getElementById(self.uid + "-mq-" + sec.id + "-" + ii);
                    if (slot) slot.style.pointerEvents = "none";
                }
            });

            var secIdx = self.getSectionIndex(sec.id);
            self.unlockSection(secIdx + 1);
        }

        self.events.trigger("changed", self.getResponse());
    };

    // ── Check Answer handler (fired by Learnosity's validate event) ──
    Question.prototype.validateCurrentStep = function () {
        var self = this;
        var resp = self.getResponse();
        if (!resp || !resp.value) return;
        self.events.trigger("changed", resp);
    };

    // ═════════════════════════════════════════════════
    // v3: RICH RESPONSE
    // ═════════════════════════════════════════════════

    /**
     * Collect all current input values across all sections.
     * Returns { "secId-rowIdx-inputIdx": { latex, correct }, "secId-inputIdx": { value, correct }, ... }
     */
    Question.prototype.collectAllInputValues = function () {
        var self = this;
        var sections = self.question.sections || [];
        var inputs = {};

        sections.forEach(function (sec) {
            if (sec.type === "equation-table") {
                sec.rows.forEach(function (row, ri) {
                    if (!row.inputs || row.inputs.length === 0) return;
                    var rowCompleted = !!(self.completedRows[sec.id] && self.completedRows[sec.id][ri]);
                    row.inputs.forEach(function (inp, ii) {
                        var key = sec.id + "-" + ri + "-" + ii;
                        var field = self.mqFields[key];
                        if (field) {
                            var latex = field.latex();
                            // Per-input correctness: if row completed, all correct;
                            // otherwise validate each input individually
                            var correct = rowCompleted;
                            if (!correct && latex) {
                                try { correct = self.validateInput(latex, inp); } catch (e) { correct = false; }
                            }
                            inputs[key] = { latex: latex, correct: correct };
                        }
                    });
                });
            } else if (sec.type === "text-with-input") {
                var secCompleted = !!self.completedSections[sec.id];
                sec.inputs.forEach(function (inp, ii) {
                    var key = sec.id + "-" + ii;
                    if (inp.type === "dropdown") {
                        var dd = document.getElementById(self.uid + "-dd-" + sec.id + "-" + ii);
                        var val = dd && dd.getValue ? dd.getValue() : "";
                        var correct = secCompleted || (val && val === inp.answer);
                        inputs[key] = { value: val, correct: correct };
                    } else {
                        var field = self.mqFields[key];
                        if (field) {
                            var latex = field.latex();
                            var correct2 = secCompleted;
                            if (!correct2 && latex) {
                                try { correct2 = self.validateInput(latex, inp); } catch (e) { correct2 = false; }
                            }
                            inputs[key] = { latex: latex, correct: correct2 };
                        }
                    }
                });
            }
        });

        return inputs;
    };

    Question.prototype.getResponse = function () {
        var self = this;
        var sections = self.question.sections || [];
        var totalSteps = 0;
        var completedSteps = 0;

        sections.forEach(function (sec) {
            if (sec.type === "text") return;
            if (sec.type === "equation-table") {
                sec.rows.forEach(function (row) {
                    if (row.inputs && row.inputs.length > 0) {
                        totalSteps++;
                        if (self.completedRows[sec.id] && self.completedRows[sec.id][sec.rows.indexOf(row)]) {
                            completedSteps++;
                        }
                    }
                });
            } else {
                totalSteps++;
                if (self.completedSections[sec.id]) completedSteps++;
            }
        });

        // Serialize completedRows/unlockedRows to plain objects with string keys
        var serCompleted = {};
        var serUnlocked = {};
        for (var sid in self.completedRows) {
            serCompleted[sid] = {};
            for (var r in self.completedRows[sid]) {
                if (self.completedRows[sid][r]) serCompleted[sid][r] = true;
            }
        }
        for (var sid2 in self.unlockedRows) {
            serUnlocked[sid2] = {};
            for (var r2 in self.unlockedRows[sid2]) {
                if (self.unlockedRows[sid2][r2]) serUnlocked[sid2][r2] = true;
            }
        }

        return {
            value: completedSteps + "/" + totalSteps,
            type: "object",
            apiVersion: "v4",
            inputs: self.collectAllInputValues(),
            completedSections: $.extend({}, self.completedSections),
            completedRows: serCompleted,
            unlockedRows: serUnlocked
        };
    };

    // ═════════════════════════════════════════════════
    // v3: RESUME MODE
    // ═════════════════════════════════════════════════

    Question.prototype.restoreFromResponse = function (response) {
        var self = this;
        if (!response || !response.inputs) {
            // No saved state — fall back to initial mode
            self.unlockSection(0);
            return;
        }

        var savedInputs = response.inputs || {};
        var savedCompletedSections = response.completedSections || {};
        var savedCompletedRows = response.completedRows || {};

        // Restore completed state
        self.completedSections = $.extend({}, savedCompletedSections);
        for (var sid in savedCompletedRows) {
            if (!self.completedRows[sid]) self.completedRows[sid] = {};
            for (var r in savedCompletedRows[sid]) {
                if (savedCompletedRows[sid][r]) self.completedRows[sid][r] = true;
            }
        }

        // Populate fields from saved inputs
        self.populateFieldsFromSaved(savedInputs);

        // Replay the unlock cascade: walk sections, fast-forward through completed ones,
        // then stop at the first incomplete section (interactive from there)
        self.replayUnlockCascade();
    };

    Question.prototype.populateFieldsFromSaved = function (savedInputs) {
        var self = this;
        for (var key in savedInputs) {
            var saved = savedInputs[key];
            if (saved.value !== undefined) {
                // Dropdown
                var parts = key.split("-");
                // key format: "secId-inputIdx" — find the dropdown element
                var ddId = self.uid + "-dd-" + key;
                var select = document.getElementById(ddId);
                if (select && saved.value) {
                    select.value = saved.value;
                }
            } else if (saved.latex !== undefined) {
                // MQ field
                var field = self.mqFields[key];
                if (field && saved.latex) {
                    field.latex(saved.latex);
                }
            }
        }
    };

    /**
     * Replay the unlock cascade using saved completedSections/completedRows.
     * Walks sections in order: for each completed section, unlock it and mark done;
     * for each completed equation-table, unlock completed rows and the next input row;
     * stops at the first incomplete section and activates it for continued work.
     */
    Question.prototype.replayUnlockCascade = function () {
        var self = this;
        var sections = self.question.sections || [];

        for (var si = 0; si < sections.length; si++) {
            var sec = sections[si];

            // Unlock the section's parent step wrapper
            var $secEl = $("#" + self.uid + "-sec-" + sec.id);
            $secEl.closest(".req-scaffold-block.req-section-locked").removeClass("req-section-locked");

            // Unlock the section itself
            $secEl.removeClass("req-section-locked");

            if (sec.type === "text") {
                // Text sections auto-complete
                self.completedSections[sec.id] = true;
                continue;
            }

            if (sec.type === "equation-table") {
                if (!self.unlockedRows[sec.id]) self.unlockedRows[sec.id] = {};
                if (!self.completedRows[sec.id]) self.completedRows[sec.id] = {};

                var tableFullyCompleted = true;
                for (var ri = 0; ri < sec.rows.length; ri++) {
                    var row = sec.rows[ri];
                    if (!row.inputs || row.inputs.length === 0) {
                        // Display-only row: auto-unlock and complete
                        self.unlockedRows[sec.id][ri] = true;
                        self.completedRows[sec.id][ri] = true;
                        continue;
                    }

                    if (self.completedRows[sec.id][ri]) {
                        // Already completed: unlock, show checkmark, disable
                        self.unlockedRows[sec.id][ri] = true;
                        var $fb = $("#" + self.uid + "-fb-" + sec.id + "-" + ri);
                        $fb.html('<span style="color:#3a9447;font-size:16px;">&#10003;</span>');
                        row.inputs.forEach(function (inp, ii) {
                            var slot = document.getElementById(self.uid + "-mq-" + sec.id + "-" + ri + "-" + ii);
                            if (slot) { slot.style.pointerEvents = "none"; $(slot).addClass("correct"); }
                        });
                        $("#" + self.uid + "-rowbtn-" + sec.id + "-" + ri).hide();
                    } else {
                        // First incomplete input row: unlock it (active) and stop
                        self.unlockedRows[sec.id][ri] = true;
                        tableFullyCompleted = false;
                        break;
                    }
                }

                self.updateRowStates(sec);

                if (tableFullyCompleted) {
                    self.completedSections[sec.id] = true;
                    continue; // Move to next section
                } else {
                    // Table not fully completed — stop cascade here
                    self.events.trigger("changed", self.getResponse());
                    return;
                }
            }

            if (sec.type === "text-with-input") {
                if (self.completedSections[sec.id]) {
                    // Completed: show tick, disable inputs
                    $("#" + self.uid + "-actions-" + sec.id).hide();
                    $("#" + self.uid + "-tick-" + sec.id).css("visibility", "visible");
                    sec.inputs.forEach(function (inp, ii) {
                        if (inp.type === "dropdown") {
                            var dd = document.getElementById(self.uid + "-dd-" + sec.id + "-" + ii);
                            if (dd && dd.setDisabled) dd.setDisabled(true);
                        } else {
                            var slot = document.getElementById(self.uid + "-mq-" + sec.id + "-" + ii);
                            if (slot) { slot.style.pointerEvents = "none"; $(slot).addClass("correct"); }
                        }
                    });
                    continue; // Move to next section
                } else {
                    // Not completed — stop cascade here (student continues from this point)
                    self.events.trigger("changed", self.getResponse());
                    return;
                }
            }
        }

        // If we get here, all sections are complete
        $("#" + self.uid + "-done").show();
        self.events.trigger("changed", self.getResponse());
    };

    Question.prototype.applyVisualState = function () {
        var self = this;
        var sections = self.question.sections || [];
        var nextIncompleteIdx = -1;

        sections.forEach(function (sec, si) {
            // Unlock group wrapper if needed
            if (sec.group && self.groupFirstIndex[sec.group] === si) {
                var groupHasUnlocked = false;
                // Check if any section in this group is unlocked
                for (var j = si; j < sections.length && sections[j].group === sec.group; j++) {
                    var sjId = sections[j].id;
                    if (self.completedSections[sjId] ||
                        (self.unlockedRows[sjId] && Object.keys(self.unlockedRows[sjId]).length > 0)) {
                        groupHasUnlocked = true;
                        break;
                    }
                    if (sections[j].type === "text") {
                        groupHasUnlocked = true;
                        break;
                    }
                }
                if (groupHasUnlocked) {
                    // Unlock step wrapper containing this section
                    var $sEl = $("#" + self.uid + "-sec-" + sec.id);
                    $sEl.closest(".req-scaffold-block.req-section-locked").removeClass("req-section-locked");
                }
            }

            var isCompleted = false;

            if (sec.type === "text") {
                if (self.completedSections[sec.id]) {
                    var $sEl2 = $("#" + self.uid + "-sec-" + sec.id);
                    $sEl2.closest(".req-scaffold-block.req-section-locked").removeClass("req-section-locked");
                    $sEl2.removeClass("req-section-locked");
                    isCompleted = true;
                }
            } else if (sec.type === "equation-table") {
                var hasAnyUnlocked = self.unlockedRows[sec.id] && Object.keys(self.unlockedRows[sec.id]).length > 0;
                if (hasAnyUnlocked || self.completedSections[sec.id]) {
                    $("#" + self.uid + "-sec-" + sec.id).removeClass("req-section-locked");
                }

                // Apply row states
                if (self.completedRows[sec.id]) {
                    sec.rows.forEach(function (row, ri) {
                        if (self.completedRows[sec.id][ri]) {
                            // Show checkmark, disable inputs, hide check button
                            var $fb = $("#" + self.uid + "-fb-" + sec.id + "-" + ri);
                            $fb.html('<span style="color:#3a9447;font-size:16px;">&#10003;</span>');
                            if (row.inputs && row.inputs.length > 0) {
                                row.inputs.forEach(function (inp, ii) {
                                    var slot = document.getElementById(self.uid + "-mq-" + sec.id + "-" + ri + "-" + ii);
                                    if (slot) {
                                        slot.style.pointerEvents = "none";
                                        $(slot).addClass("correct");
                                    }
                                });
                                $("#" + self.uid + "-rowbtn-" + sec.id + "-" + ri).hide();
                            }
                        }
                    });
                }

                self.updateRowStates(sec);
                isCompleted = !!self.completedSections[sec.id];

            } else if (sec.type === "text-with-input") {
                if (self.completedSections[sec.id]) {
                    $("#" + self.uid + "-sec-" + sec.id).removeClass("req-section-locked");
                    // Hide actions, show tick, disable inputs
                    $("#" + self.uid + "-actions-" + sec.id).hide();
                    $("#" + self.uid + "-tick-" + sec.id).css("visibility", "visible");
                    sec.inputs.forEach(function (inp, ii) {
                        if (inp.type === "dropdown") {
                            var dd = document.getElementById(self.uid + "-dd-" + sec.id + "-" + ii);
                            if (dd && dd.setDisabled) dd.setDisabled(true);
                        } else {
                            var slot = document.getElementById(self.uid + "-mq-" + sec.id + "-" + ii);
                            if (slot) {
                                slot.style.pointerEvents = "none";
                                $(slot).addClass("correct");
                            }
                        }
                    });
                    isCompleted = true;
                } else {
                    // Check if it has been unlocked (previous section was completed)
                    var prevCompleted = (si === 0);
                    if (!prevCompleted && si > 0) {
                        var prevSec = sections[si - 1];
                        prevCompleted = !!self.completedSections[prevSec.id];
                    }
                    if (prevCompleted) {
                        $("#" + self.uid + "-sec-" + sec.id).removeClass("req-section-locked");
                    }
                }
            }

            // Track next incomplete section for focus
            if (!isCompleted && nextIncompleteIdx === -1 && sec.type !== "text") {
                nextIncompleteIdx = si;
            }
        });

        // Check if all done
        var allDone = true;
        sections.forEach(function (sec) {
            if (sec.type === "text") return;
            if (!self.completedSections[sec.id]) allDone = false;
        });
        if (allDone) {
            $("#" + self.uid + "-done").show();
        }

        self.events.trigger("changed", self.getResponse());
    };

    // ═════════════════════════════════════════════════
    // v3: REVIEW MODE
    // ═════════════════════════════════════════════════

    Question.prototype.applyReviewMode = function () {
        var self = this;
        var sections = self.question.sections || [];
        var savedInputs = (self.response && self.response.inputs) ? self.response.inputs : {};
        var savedCompletedRows = (self.response && self.response.completedRows) ? self.response.completedRows : {};
        var savedCompletedSections = (self.response && self.response.completedSections) ? self.response.completedSections : {};

        // Add review mode class
        self.$el.find(".req-widget").addClass("req-review-mode");

        // Unlock ALL sections and groups
        self.$el.find(".req-section-locked").removeClass("req-section-locked");

        // Unlock all rows
        sections.forEach(function (sec) {
            if (sec.type === "equation-table") {
                sec.rows.forEach(function (row, ri) {
                    var $tr = $("#" + self.uid + "-row-" + sec.id + "-" + ri);
                    var $trBtn = $("#" + self.uid + "-rowbtn-" + sec.id + "-" + ri);
                    $tr.removeClass("locked").addClass("completed");
                    $trBtn.removeClass("locked").addClass("completed");
                });
            }
        });

        // Populate fields from saved response
        self.populateFieldsFromSaved(savedInputs);

        // Mark each input correct/incorrect — only if it has content
        for (var key in savedInputs) {
            var saved = savedInputs[key];
            var isCorrect = !!saved.correct;

            if (saved.value !== undefined) {
                // Dropdown — only style if a value was selected
                if (!saved.value) continue;
                var ddId = self.uid + "-dd-" + key;
                var select = document.getElementById(ddId);
                if (select) {
                    $(select).addClass(isCorrect ? "correct" : "incorrect");
                }
            } else if (saved.latex !== undefined) {
                // MQ field — only style if student typed something
                if (!saved.latex) continue;
                var slotId = self.uid + "-mq-" + key;
                var slot = document.getElementById(slotId);
                if (slot) {
                    $(slot).addClass(isCorrect ? "correct" : "incorrect");
                }
            }
        }

        // Show feedback ticks/crosses for equation table rows
        sections.forEach(function (sec) {
            if (sec.type === "equation-table") {
                sec.rows.forEach(function (row, ri) {
                    if (!row.inputs || row.inputs.length === 0) return;
                    var rowCompleted = !!(savedCompletedRows[sec.id] && savedCompletedRows[sec.id][ri]);
                    var $fb = $("#" + self.uid + "-fb-" + sec.id + "-" + ri);
                    if (rowCompleted) {
                        $fb.html('<span style="color:#3a9447;font-size:16px;">&#10003;</span>');
                    } else {
                        // Show cross for incomplete rows that have input
                        var hasInput = false;
                        row.inputs.forEach(function (inp, ii) {
                            var savedKey = sec.id + "-" + ri + "-" + ii;
                            if (savedInputs[savedKey] && (savedInputs[savedKey].latex || savedInputs[savedKey].value)) {
                                hasInput = true;
                            }
                        });
                        if (hasInput) {
                            $fb.html('<span style="color:#e8883a;font-size:16px;">&#10007;</span>');
                        }
                    }
                });
            } else if (sec.type === "text-with-input") {
                var secCompleted = !!savedCompletedSections[sec.id];
                if (secCompleted) {
                    $("#" + self.uid + "-tick-" + sec.id).css("visibility", "visible");
                }
            }
        });

        // Add numbered badges to inputs (teacher view)
        var inputNum = 0;
        sections.forEach(function (sec) {
            if (sec.type === "equation-table") {
                sec.rows.forEach(function (row, ri) {
                    if (!row.inputs || row.inputs.length === 0) return;
                    if (row.containers && row.containers.length > 0) {
                        // Multi-container: one badge per container, individual badges for non-container inputs
                        var containerInputSet = {};
                        row.containers.forEach(function (ctr) {
                            if (ctr.inputIndices) ctr.inputIndices.forEach(function (idx) { containerInputSet[idx] = true; });
                        });
                        // Iterate inputs in order; when hitting first input of a container, emit container badge
                        var emittedContainers = {};
                        row.inputs.forEach(function (inp, ii) {
                            // Check if this input belongs to a container
                            var belongsTo = -1;
                            row.containers.forEach(function (ctr, ci) {
                                if (ctr.inputIndices && ctr.inputIndices.indexOf(ii) >= 0) belongsTo = ci;
                            });
                            if (belongsTo >= 0) {
                                if (!emittedContainers[belongsTo]) {
                                    emittedContainers[belongsTo] = true;
                                    inputNum++;
                                    // Badge on first input slot of this container
                                    var firstIdx = row.containers[belongsTo].inputIndices[0];
                                    var slotId = self.uid + "-mq-" + sec.id + "-" + ri + "-" + firstIdx;
                                    var slot = document.getElementById(slotId);
                                    if (slot) {
                                        $(slot).addClass("req-input-numbered req-container-numbered");
                                        $(slot).prepend($('<span class="req-num-badge req-container-badge"></span>').text(inputNum));
                                    }
                                }
                            } else {
                                inputNum++;
                                var slotId = self.uid + "-mq-" + sec.id + "-" + ri + "-" + ii;
                                var slot = document.getElementById(slotId);
                                if (slot) {
                                    $(slot).addClass("req-input-numbered");
                                    $(slot).prepend($('<span class="req-num-badge"></span>').text(inputNum));
                                }
                            }
                        });
                    } else if (row.container) {
                        // Legacy single container: one badge on the expression cell
                        inputNum++;
                        var $row = $("#" + self.uid + "-row-" + sec.id + "-" + ri);
                        var $exprCell = $row.find("td:first");
                        $exprCell.addClass("req-container-numbered");
                        $exprCell.prepend($('<span class="req-num-badge req-container-badge"></span>').text(inputNum));
                    } else {
                        row.inputs.forEach(function (inp, ii) {
                            inputNum++;
                            var slotId = self.uid + "-mq-" + sec.id + "-" + ri + "-" + ii;
                            var slot = document.getElementById(slotId);
                            if (slot) {
                                $(slot).addClass("req-input-numbered");
                                $(slot).prepend($('<span class="req-num-badge"></span>').text(inputNum));
                            }
                        });
                    }
                });
            } else if (sec.type === "text-with-input") {
                sec.inputs.forEach(function (inp, ii) {
                    inputNum++;
                    if (inp.type === "dropdown") {
                        var ddId = self.uid + "-dd-" + sec.id + "-" + ii;
                        var dd = document.getElementById(ddId);
                        if (dd) {
                            var $wrap = $(dd).wrap('<span class="req-input-numbered"></span>').parent();
                            $wrap.prepend($('<span class="req-num-badge"></span>').text(inputNum));
                        }
                    } else {
                        var slotId = self.uid + "-mq-" + sec.id + "-" + ii;
                        var slot = document.getElementById(slotId);
                        if (slot) {
                            $(slot).addClass("req-input-numbered");
                            $(slot).prepend($('<span class="req-num-badge"></span>').text(inputNum));
                        }
                    }
                });
            }
        });

        // Hide all Check buttons and keypad
        self.$el.find(".req-check-btn").hide();
        self.$el.find(".req-actions").each(function () {
            $(this).find(".req-check-btn").hide();
        });
        $("#" + self.uid + "-keypad").remove();
        self.$el.find(".req-hint-btn").hide();

        // Hide button rows for equation tables
        self.$el.find("[id^='" + self.uid + "-rowbtn-']").hide();

        // Show done banner if all complete
        var allDone = true;
        sections.forEach(function (sec) {
            if (sec.type === "text") return;
            if (!savedCompletedSections[sec.id]) allDone = false;
        });
        if (allDone) {
            $("#" + self.uid + "-done").show();
        }
    };

    /**
     * Convert a nerdamer expression string to display LaTeX.
     * Basic conversion for common patterns.
     */
    /**
     * Convert a nerdamer expression string to clean display LaTeX.
     * Produces e.g. "3(2x-1)" not "3 \cdot (2 \cdot x - 1)".
     * Only uses \cdot if the original answer string literally contains "\cdot".
     */
    Question.prototype.nerdamerToDisplayLatex = function (expr) {
        if (!expr) return "";
        var s = expr;

        // Handle set values like "3,-2"
        if (s.indexOf(",") >= 0) {
            var self = this;
            return s.split(",").map(function (p) {
                return self.nerdamerToDisplayLatex(p.trim());
            }).join(",\\;");
        }

        // If the answer already contains LaTeX commands, return as-is
        if (s.indexOf("\\") >= 0) return s;

        // Convert nerdamer expression to clean LaTeX:
        // 1. Fractions: a/b → \frac{a}{b} (only top-level slash)
        if (/^[^()]+\/[^()]+$/.test(s) && s.indexOf("log") < 0) {
            var slashIdx = s.indexOf("/");
            var num = s.substring(0, slashIdx).trim();
            var den = s.substring(slashIdx + 1).trim();
            return "\\frac{" + num + "}{" + den + "}";
        }

        // For compound fractions like log(25)/(4*log(2)), use nerdamer
        if (s.indexOf("/") >= 0) {
            try {
                if (window.nerdamer) {
                    var tex = nerdamer(s).toTeX();
                    // Clean up cdots from nerdamer output
                    tex = tex.replace(/\\cdot\s*/g, "");
                    return tex;
                }
            } catch (e) {}
        }

        // 2. Remove * between number and parenthesis: 3*(2*x-1) → 3(2x-1)
        //    Remove * between number and variable: 6*x → 6x
        //    Remove * between variable and parenthesis
        //    Keep * only if it would be ambiguous (two variables side by side)
        s = s.replace(/\*\(/g, "(");           // n*( → n(
        s = s.replace(/\)\*/g, ")");           // )*n → )n
        s = s.replace(/(\d)\*([a-zA-Z])/g, "$1$2");  // 6*x → 6x
        s = s.replace(/([a-zA-Z])\*(\d)/g, "$1 \\cdot $2"); // x*3 → x · 3 (rare, keep explicit)
        s = s.replace(/([a-zA-Z])\*([a-zA-Z])/g, "$1$2");   // a*b → ab

        // 3. Exponents: ^(...) → ^{...}
        s = s.replace(/\^\(([^()]+)\)/g, "^{$1}");
        s = s.replace(/\^(\d+)/g, "^{$1}");
        s = s.replace(/\^([a-zA-Z])/g, "^{$1}");

        return s;
    };

    /**
     * Render (or re-render) the Correct Answers panel.
     * Static version used by review mode — shows all answers.
     */
    Question.prototype.renderCorrectAnswersPanel = function () {
        this._renderCorrectAnswersPanelDynamic({}, {});
    };

    /**
     * v4: Dynamic Correct Answers panel.
     * Skips inputs whose row/section is already completed by the student.
     * Hides the entire panel when all inputs are completed.
     */
    Question.prototype._renderCorrectAnswersPanelDynamic = function (completedRows, completedSections) {
        var self = this;
        var sections = self.question.sections || [];

        // Remove existing panel
        self.$el.find(".req-correct-answers").remove();

        var $panel = $('<div class="req-correct-answers"></div>');
        var $title = $('<p class="req-ca-title">Correct Answers:</p>');
        var $grid = $('<div class="req-ca-grid"></div>');
        var num = 0;
        var shown = 0;

        sections.forEach(function (sec) {
            if (sec.type === "equation-table") {
                sec.rows.forEach(function (row, ri) {
                    if (!row.inputs || row.inputs.length === 0) return;
                    var rowDone = !!(completedRows[sec.id] && completedRows[sec.id][ri]);
                    if (row.containers && row.containers.length > 0) {
                        // Multi-container: one box per container showing assembled answer,
                        // individual boxes for non-container inputs
                        var containerInputSet = {};
                        row.containers.forEach(function (ctr) {
                            if (ctr.inputIndices) ctr.inputIndices.forEach(function (idx) { containerInputSet[idx] = true; });
                        });
                        var emittedContainers = {};
                        row.inputs.forEach(function (inp, ii) {
                            var belongsTo = -1;
                            row.containers.forEach(function (ctr, ci) {
                                if (ctr.inputIndices && ctr.inputIndices.indexOf(ii) >= 0) belongsTo = ci;
                            });
                            if (belongsTo >= 0) {
                                if (!emittedContainers[belongsTo]) {
                                    emittedContainers[belongsTo] = true;
                                    num++;
                                    if (!rowDone) {
                                        shown++;
                                        // Build assembled answer from container's assembleTemplate
                                        var ctr = row.containers[belongsTo];
                                        var displayParts = ctr.assembleTemplate || "{{0}}";
                                        ctr.inputIndices.forEach(function (idx, localI) {
                                            var dispLtx = self.nerdamerToDisplayLatex(row.inputs[idx].answer);
                                            displayParts = displayParts.replace("{{" + localI + "}}", dispLtx);
                                        });
                                        var $box = $('<div class="req-ca-box"></div>');
                                        $box.append($('<span class="req-num-badge"></span>').text(num));
                                        var $val = $('<span></span>');
                                        try {
                                            $val.html(katex.renderToString(displayParts, { throwOnError: false }));
                                        } catch (e) {
                                            $val.text(ctr.answer || displayParts);
                                        }
                                        $box.append($val);
                                        $grid.append($box);
                                    }
                                }
                            } else {
                                num++;
                                if (!rowDone) {
                                    shown++;
                                    var displayLatex = self.nerdamerToDisplayLatex(inp.answer);
                                    var $box = $('<div class="req-ca-box"></div>');
                                    $box.append($('<span class="req-num-badge"></span>').text(num));
                                    var $val = $('<span></span>');
                                    try {
                                        $val.html(katex.renderToString(displayLatex, { throwOnError: false }));
                                    } catch (e) {
                                        $val.text(inp.answer);
                                    }
                                    $box.append($val);
                                    $grid.append($box);
                                }
                            }
                        });
                    } else if (row.container) {
                        // Legacy single container: one box showing assembled answer
                        num++;
                        if (!rowDone) {
                            shown++;
                            var tpl = self._stripContainerDelims(row.template || "{{0}}");
                            var displayParts = tpl;
                            row.inputs.forEach(function (inp, ii) {
                                var dispLtx = self.nerdamerToDisplayLatex(inp.answer);
                                displayParts = displayParts.replace("{{" + ii + "}}", dispLtx);
                            });
                            var $box = $('<div class="req-ca-box"></div>');
                            $box.append($('<span class="req-num-badge"></span>').text(num));
                            var $val = $('<span></span>');
                            try {
                                $val.html(katex.renderToString(displayParts, { throwOnError: false }));
                            } catch (e) {
                                $val.text(displayParts);
                            }
                            $box.append($val);
                            $grid.append($box);
                        }
                    } else {
                        row.inputs.forEach(function (inp) {
                            num++;
                            if (rowDone) return; // skip completed
                            shown++;
                            var displayLatex = self.nerdamerToDisplayLatex(inp.answer);
                            var $box = $('<div class="req-ca-box"></div>');
                            $box.append($('<span class="req-num-badge"></span>').text(num));
                            var $val = $('<span></span>');
                            try {
                                $val.html(katex.renderToString(displayLatex, { throwOnError: false }));
                            } catch (e) {
                                $val.text(inp.answer);
                            }
                            $box.append($val);
                            $grid.append($box);
                        });
                    }
                });
            } else if (sec.type === "text-with-input") {
                var secDone = !!completedSections[sec.id];
                sec.inputs.forEach(function (inp) {
                    num++;
                    if (secDone) return; // skip completed
                    shown++;
                    var $box = $('<div class="req-ca-box"></div>');
                    $box.append($('<span class="req-num-badge"></span>').text(num));
                    var $val = $('<span></span>');
                    if (inp.type === "dropdown") {
                        var ans = inp.answer;
                        var rAns = self._renderDNOption(ans);
                        if (rAns) { $val.html(rAns); } else { $val.text(ans); }
                    } else {
                        var displayLatex = self.nerdamerToDisplayLatex(inp.answer);
                        try {
                            $val.html(katex.renderToString(displayLatex, { throwOnError: false }));
                        } catch (e) {
                            $val.text(inp.answer);
                        }
                    }
                    $box.append($val);
                    $grid.append($box);
                });
            }
        });

        // Only show panel if there are remaining unanswered inputs
        if (shown > 0) {
            $panel.append($title).append($grid);
            self.$el.find(".req-widget").append($panel);
        }
    };

    // ═════════════════════════════════════════════════
    // v4: TEACHER LIVE MODE
    // ═════════════════════════════════════════════════

    /**
     * Set up the teacher live view: reveal all sections grayed out,
     * disable all interactivity. Per-step visibility is managed by
     * _updateTeacherStepStates() which is called on every response update.
     */
    Question.prototype._applyTeacherLiveMode = function () {
        var self = this;
        var sections = self.question.sections || [];

        // Add teacher-live class
        self.$el.find(".req-widget").addClass("req-teacher-live");

        // Unlock ALL sections and groups so teacher can see everything
        self.$el.find(".req-section-locked").removeClass("req-section-locked");

        // Unlock all equation table rows (make visible)
        sections.forEach(function (sec) {
            if (sec.type === "equation-table") {
                if (!self.unlockedRows[sec.id]) self.unlockedRows[sec.id] = {};
                if (!self.completedRows[sec.id]) self.completedRows[sec.id] = {};
                sec.rows.forEach(function (row, ri) {
                    self.unlockedRows[sec.id][ri] = true;
                    var $tr = $("#" + self.uid + "-row-" + sec.id + "-" + ri);
                    var $trBtn = $("#" + self.uid + "-rowbtn-" + sec.id + "-" + ri);
                    $tr.removeClass("locked").addClass("active");
                    $trBtn.removeClass("locked");
                });
            }
        });

        // Hide ALL Check buttons, hint buttons, keypad
        self.$el.find(".req-check-btn").hide();
        self.$el.find("[id^='" + self.uid + "-rowbtn-']").hide();
        $("#" + self.uid + "-keypad").remove();
        self.$el.find(".req-hint-btn").hide();
        $("#" + self.uid + "-done").hide();

        // Disable all MQ fields and dropdowns
        for (var key in self.mqFields) {
            var slot = self.mqFields[key].el();
            if (slot) slot.style.pointerEvents = "none";
        }
        self.$el.find(".req-dropdown-wrap").each(function () { if (this.setDisabled) this.setDisabled(true); });

        // Mark everything as grayed initially — individual rows/sections get
        // .req-tl-grayed (future), .req-tl-active (current), or .req-tl-completed (done)
        sections.forEach(function (sec) {
            if (sec.type === "equation-table") {
                sec.rows.forEach(function (row, ri) {
                    $("#" + self.uid + "-row-" + sec.id + "-" + ri).addClass("req-tl-grayed");
                });
            } else if (sec.type === "text-with-input") {
                $("#" + self.uid + "-sec-" + sec.id).addClass("req-tl-grayed");
            } else if (sec.type === "text") {
                $("#" + self.uid + "-sec-" + sec.id).addClass("req-tl-grayed");
            }
        });

        // Add numbered badges to inputs
        var inputNum = 0;
        sections.forEach(function (sec) {
            if (sec.type === "equation-table") {
                sec.rows.forEach(function (row, ri) {
                    if (!row.inputs || row.inputs.length === 0) return;
                    if (row.containers && row.containers.length > 0) {
                        // Multi-container: one badge per container, individual badges for non-container inputs
                        // Badges are deferred to _addContainerBadges (runs after overlays exist at 600ms)
                        var containerInputSet = {};
                        row.containers.forEach(function (ctr) {
                            if (ctr.inputIndices) ctr.inputIndices.forEach(function (idx) { containerInputSet[idx] = true; });
                        });
                        var emittedContainers = {};
                        row.inputs.forEach(function (inp, ii) {
                            var belongsTo = -1;
                            row.containers.forEach(function (ctr, ci) {
                                if (ctr.inputIndices && ctr.inputIndices.indexOf(ii) >= 0) belongsTo = ci;
                            });
                            if (belongsTo >= 0) {
                                if (!emittedContainers[belongsTo]) {
                                    emittedContainers[belongsTo] = true;
                                    inputNum++;
                                    // Store deferred badge info for this container
                                    self._deferredContainerBadges = self._deferredContainerBadges || [];
                                    self._deferredContainerBadges.push({
                                        cwrapId: self.uid + "-cwrap-" + sec.id + "-" + ri + "-" + belongsTo,
                                        num: inputNum
                                    });
                                }
                            } else {
                                inputNum++;
                                var slotId = self.uid + "-mq-" + sec.id + "-" + ri + "-" + ii;
                                var slot = document.getElementById(slotId);
                                if (slot) {
                                    $(slot).addClass("req-input-numbered");
                                    $(slot).prepend($('<span class="req-num-badge"></span>').text(inputNum));
                                }
                            }
                        });
                    } else if (row.container) {
                        // Legacy single container: one badge on the expression cell
                        inputNum++;
                        var $row = $("#" + self.uid + "-row-" + sec.id + "-" + ri);
                        var $exprCell = $row.find("td:first");
                        $exprCell.addClass("req-container-numbered");
                        $exprCell.prepend($('<span class="req-num-badge req-container-badge"></span>').text(inputNum));
                    } else {
                        row.inputs.forEach(function (inp, ii) {
                            inputNum++;
                            var slotId = self.uid + "-mq-" + sec.id + "-" + ri + "-" + ii;
                            var slot = document.getElementById(slotId);
                            if (slot) {
                                $(slot).addClass("req-input-numbered");
                                $(slot).prepend($('<span class="req-num-badge"></span>').text(inputNum));
                            }
                        });
                    }
                });
            } else if (sec.type === "text-with-input") {
                sec.inputs.forEach(function (inp, ii) {
                    inputNum++;
                    if (inp.type === "dropdown") {
                        var ddId = self.uid + "-dd-" + sec.id + "-" + ii;
                        var dd = document.getElementById(ddId);
                        if (dd) {
                            var $wrap = $(dd).wrap('<span class="req-input-numbered"></span>').parent();
                            $wrap.prepend($('<span class="req-num-badge"></span>').text(inputNum));
                        }
                    } else {
                        var slotId = self.uid + "-mq-" + sec.id + "-" + ii;
                        var slot = document.getElementById(slotId);
                        if (slot) {
                            $(slot).addClass("req-input-numbered");
                            $(slot).prepend($('<span class="req-num-badge"></span>').text(inputNum));
                        }
                    }
                });
            }
        });

        // Apply initial step states (first step active, rest grayed)
        self._updateTeacherStepStates({}, {});

        // Show correct answers panel (all answers initially)
        self._renderCorrectAnswersPanelDynamic({}, {});

        // Deferred container badges — overlays are created at 500ms, so add badges at 700ms
        if (self._deferredContainerBadges && self._deferredContainerBadges.length > 0) {
            var badges = self._deferredContainerBadges;
            self._deferredContainerBadges = [];
            setTimeout(function () {
                badges.forEach(function (b) {
                    var $cw = $("#" + b.cwrapId);
                    if ($cw.length) {
                        $cw.find(".req-num-badge").remove();
                        $cw.append($('<span class="req-num-badge req-container-badge" style="position:absolute;top:-10px;left:-6px;z-index:3;"></span>').text(b.num));
                    }
                });
                // Re-trigger teacher update now that overlays + badges exist
                if (self.response && self.response.inputs) {
                    self._updateTeacherFromResponse(self.response);
                }
            }, 700);
        }
    };

    /**
     * v4: Update per-step visual states on the teacher side.
     *
     * Three states per step:
     *  - req-tl-completed: student finished this step → same styling as student's completed
     *  - req-tl-active: student is currently working here → light gray background highlight
     *  - req-tl-grayed: student hasn't reached here yet → grayed out
     */
    Question.prototype._updateTeacherStepStates = function (completedRows, completedSections) {
        var self = this;
        var sections = self.question.sections || [];
        var foundActive = false;
        var allDone = true;

        sections.forEach(function (sec) {
            if (sec.type === "text") {
                // Text sections follow: completed if previous section is completed,
                // or if they precede the first active step (they auto-complete on student side)
                var $secEl = $("#" + self.uid + "-sec-" + sec.id);
                $secEl.removeClass("req-tl-grayed req-tl-active req-tl-completed");
                if (foundActive) {
                    $secEl.addClass("req-tl-grayed");
                } else {
                    $secEl.addClass("req-tl-completed");
                }
                return;
            }

            if (sec.type === "equation-table") {
                var secCompleted = !!completedSections[sec.id];
                sec.rows.forEach(function (row, ri) {
                    var $tr = $("#" + self.uid + "-row-" + sec.id + "-" + ri);
                    $tr.removeClass("req-tl-grayed req-tl-active req-tl-completed");

                    if (!row.inputs || row.inputs.length === 0) {
                        // Display-only row: follows same pattern as text
                        if (foundActive) {
                            $tr.addClass("req-tl-grayed");
                        } else {
                            $tr.addClass("req-tl-completed");
                        }
                        return;
                    }

                    var rowDone = !!(completedRows[sec.id] && completedRows[sec.id][ri]);
                    // Teacher hint: show for active step only
                    var $rowHint = $("#" + self.uid + "-hint-" + sec.id + "-" + ri);
                    if (rowDone) {
                        $tr.addClass("req-tl-completed");
                        $rowHint.removeClass("visible");
                    } else if (!foundActive) {
                        // First incomplete input row = active step
                        $tr.addClass("req-tl-active");
                        if ($rowHint.length) $rowHint.addClass("visible");
                        foundActive = true;
                        allDone = false;
                    } else {
                        $tr.addClass("req-tl-grayed");
                        $rowHint.removeClass("visible");
                        allDone = false;
                    }
                });

            } else if (sec.type === "text-with-input") {
                var $secEl = $("#" + self.uid + "-sec-" + sec.id);
                $secEl.removeClass("req-tl-grayed req-tl-active req-tl-completed");

                var $secHint = $("#" + self.uid + "-hint-" + sec.id);
                if (completedSections[sec.id]) {
                    $secEl.addClass("req-tl-completed");
                    $secHint.removeClass("visible");
                } else if (!foundActive) {
                    $secEl.addClass("req-tl-active");
                    if ($secHint.length) $secHint.addClass("visible");
                    foundActive = true;
                    allDone = false;
                } else {
                    $secEl.addClass("req-tl-grayed");
                    $secHint.removeClass("visible");
                    allDone = false;
                }
            }
        });

        // Show done banner if all complete
        if (allDone && !foundActive) {
            // Check there's at least one completable step
            var hasSteps = false;
            sections.forEach(function (s) { if (s.type !== "text") hasSteps = true; });
            if (hasSteps) {
                var totalCompleted = true;
                sections.forEach(function (s) {
                    if (s.type === "text") return;
                    if (!completedSections[s.id]) totalCompleted = false;
                });
                if (totalCompleted) {
                    $("#" + self.uid + "-done").show();
                }
            }
        }
    };

    /**
     * v4: Update teacher view in real time from student's response.
     * Populates fields, shows correctness markers, updates step progress.
     */
    Question.prototype._updateTeacherFromResponse = function (response) {
        var self = this;
        if (!response) return;

        var savedInputs = response.inputs || {};
        var savedCompletedRows = response.completedRows || {};
        var savedCompletedSections = response.completedSections || {};
        var sections = self.question.sections || [];

        // Restore completed state for progress calculation
        self.completedSections = $.extend({}, savedCompletedSections);
        for (var sid in savedCompletedRows) {
            if (!self.completedRows[sid]) self.completedRows[sid] = {};
            for (var r in savedCompletedRows[sid]) {
                if (savedCompletedRows[sid][r]) self.completedRows[sid][r] = true;
            }
        }

        // Build a set of keys that belong to container rows (skip per-box coloring)
        var containerKeys = {};
        sections.forEach(function (sec) {
            if (sec.type === "equation-table") {
                sec.rows.forEach(function (row, ri) {
                    if (row.containers && row.containers.length > 0) {
                        // Multi-container: mark all inputs in any container
                        row.containers.forEach(function (ctr) {
                            if (ctr.inputIndices) ctr.inputIndices.forEach(function (idx) {
                                containerKeys[sec.id + "-" + ri + "-" + idx] = true;
                            });
                        });
                    } else if (row.container && row.inputs) {
                        row.inputs.forEach(function (inp, ii) {
                            containerKeys[sec.id + "-" + ri + "-" + ii] = true;
                        });
                    }
                });
            }
        });

        // Populate fields and mark correctness
        for (var key in savedInputs) {
            var saved = savedInputs[key];

            if (saved.value !== undefined) {
                // Dropdown (custom req-dropdown-wrap with setValue/getValue)
                var ddId = self.uid + "-dd-" + key;
                var ddEl = document.getElementById(ddId);
                if (ddEl && saved.value) {
                    if (ddEl.setValue) {
                        ddEl.setValue(saved.value);
                    }
                    $(ddEl).removeClass("correct incorrect");
                    if (saved.correct) {
                        $(ddEl).addClass("correct");
                    } else if (saved.value) {
                        $(ddEl).addClass("incorrect");
                    }
                }
            } else if (saved.latex !== undefined) {
                // MQ field
                var field = self.mqFields[key];
                if (field) {
                    // Only update if value differs to avoid cursor jumping
                    if (field.latex() !== saved.latex) {
                        field.latex(saved.latex);
                    }
                }
                // Apply correctness styling — skip for container boxes (teacher shows wrap border instead)
                if (!containerKeys[key]) {
                    var slotId = self.uid + "-mq-" + key;
                    var slot = document.getElementById(slotId);
                    if (slot) {
                        $(slot).removeClass("correct incorrect");
                        if (saved.latex) {
                            $(slot).addClass(saved.correct ? "correct" : "incorrect");
                        }
                    }
                }
            }
        }

        // Update feedback ticks/crosses for equation table rows
        sections.forEach(function (sec) {
            if (sec.type === "equation-table") {
                sec.rows.forEach(function (row, ri) {
                    if (!row.inputs || row.inputs.length === 0) return;
                    var rowCompleted = !!(savedCompletedRows[sec.id] && savedCompletedRows[sec.id][ri]);
                    var $fb = $("#" + self.uid + "-fb-" + sec.id + "-" + ri);
                    if (rowCompleted) {
                        $fb.html('<span style="color:#3a9447;font-size:16px;">&#10003;</span>');
                        // Container wrap: green border
                        if (row.containers && row.containers.length > 0) {
                            row.containers.forEach(function (ctr, ci) {
                                var $cw = $("#" + self.uid + "-cwrap-" + sec.id + "-" + ri + "-" + ci);
                                $cw.removeClass("req-cwrap-incorrect").addClass("req-cwrap-correct");
                            });
                        } else if (row.container) {
                            var $cw = $("#" + self.uid + "-cwrap-" + sec.id + "-" + ri);
                            $cw.removeClass("req-cwrap-incorrect").addClass("req-cwrap-correct");
                            $cw.find(".req-cwrap-tick").remove();
                            $cw.append('<span class="req-cwrap-tick" style="color:#3a9447;font-size:14px;margin-left:6px;vertical-align:middle;">&#10003;</span>');
                        }
                    } else if (row.containers && row.containers.length > 0) {
                        // Multi-container: validate each container, style wraps
                        var allContainersOk = true;
                        row.containers.forEach(function (ctr, ci) {
                            if (!ctr.inputIndices) return;
                            var boxLatex = [];
                            var allFilled = true;
                            ctr.inputIndices.forEach(function (idx) {
                                var savedKey = sec.id + "-" + ri + "-" + idx;
                                var sv = savedInputs[savedKey];
                                if (sv && sv.latex) {
                                    boxLatex.push(sv.latex);
                                } else {
                                    allFilled = false;
                                }
                            });
                            var $cw = $("#" + self.uid + "-cwrap-" + sec.id + "-" + ri + "-" + ci);
                            $cw.removeClass("req-cwrap-correct req-cwrap-incorrect");
                            if (allFilled) {
                                var containerOk = self.validateContainer(ctr, boxLatex);
                                if (!containerOk) allContainersOk = false;
                                $cw.addClass(containerOk ? "req-cwrap-correct" : "req-cwrap-incorrect");
                            } else {
                                allContainersOk = false;
                            }
                        });
                        // Also check non-container inputs in the row
                        var containerInputSet = {};
                        row.containers.forEach(function (ctr) {
                            if (ctr.inputIndices) ctr.inputIndices.forEach(function (idx) { containerInputSet[idx] = true; });
                        });
                        var nonContainerOk = true, allNonContainerFilled = true;
                        row.inputs.forEach(function (inp, ii) {
                            if (containerInputSet[ii]) return;
                            var savedKey = sec.id + "-" + ri + "-" + ii;
                            var sv = savedInputs[savedKey];
                            if (sv && sv.latex) {
                                if (!sv.correct) nonContainerOk = false;
                            } else {
                                allNonContainerFilled = false;
                            }
                        });
                        // Row-level feedback: only show ✓ when ALL inputs (containers + non-containers) are filled and correct
                        var anyFilled = false;
                        row.inputs.forEach(function (inp, ii) {
                            var savedKey = sec.id + "-" + ri + "-" + ii;
                            if (savedInputs[savedKey] && (savedInputs[savedKey].latex || savedInputs[savedKey].value)) anyFilled = true;
                        });
                        if (anyFilled) {
                            // allContainersOk is false if any container has unfilled inputs
                            var rowOk = allContainersOk && nonContainerOk && allNonContainerFilled;
                            $fb.html(rowOk
                                ? '<span style="color:#3a9447;font-size:16px;">&#10003;</span>'
                                : '<span style="color:#e8883a;font-size:16px;">&#10007;</span>');
                        } else {
                            $fb.html("");
                        }
                    } else if (row.container) {
                        // Legacy single container: run live validation on synced input values
                        var boxLatex = [];
                        var allFilled = true;
                        row.inputs.forEach(function (inp, ii) {
                            var savedKey = sec.id + "-" + ri + "-" + ii;
                            var sv = savedInputs[savedKey];
                            if (sv && sv.latex) {
                                boxLatex.push(sv.latex);
                            } else {
                                allFilled = false;
                            }
                        });
                        var $cw = $("#" + self.uid + "-cwrap-" + sec.id + "-" + ri);
                        $cw.find(".req-cwrap-tick").remove();
                        $cw.removeClass("req-cwrap-correct req-cwrap-incorrect");
                        if (allFilled) {
                            var containerOk = self.validateContainer(row.container, boxLatex);
                            $fb.html(containerOk
                                ? '<span style="color:#3a9447;font-size:16px;">&#10003;</span>'
                                : '<span style="color:#e8883a;font-size:16px;">&#10007;</span>');
                            $cw.addClass(containerOk ? "req-cwrap-correct" : "req-cwrap-incorrect");
                            $cw.append(containerOk
                                ? '<span class="req-cwrap-tick" style="color:#3a9447;font-size:14px;margin-left:6px;vertical-align:middle;">&#10003;</span>'
                                : '<span class="req-cwrap-tick" style="color:#e8883a;font-size:14px;margin-left:6px;vertical-align:middle;">&#10007;</span>');
                        } else {
                            $fb.html("");
                        }
                    } else {
                        // Non-container: use per-input saved.correct flags
                        var hasInput = false;
                        row.inputs.forEach(function (inp, ii) {
                            var savedKey = sec.id + "-" + ri + "-" + ii;
                            if (savedInputs[savedKey] && (savedInputs[savedKey].latex || savedInputs[savedKey].value)) {
                                hasInput = true;
                            }
                        });
                        if (hasInput) {
                            var anyWrong = false;
                            row.inputs.forEach(function (inp, ii) {
                                var savedKey = sec.id + "-" + ri + "-" + ii;
                                if (savedInputs[savedKey] && savedInputs[savedKey].latex && !savedInputs[savedKey].correct) {
                                    anyWrong = true;
                                }
                            });
                            if (anyWrong) {
                                $fb.html('<span style="color:#e8883a;font-size:16px;">&#10007;</span>');
                            } else {
                                $fb.html('<span style="color:#3a9447;font-size:16px;">&#10003;</span>');
                            }
                        } else {
                            $fb.html("");
                        }
                    }
                });
            } else if (sec.type === "text-with-input") {
                var secCompleted = !!savedCompletedSections[sec.id];
                if (secCompleted) {
                    $("#" + self.uid + "-tick-" + sec.id).css("visibility", "visible");
                } else {
                    $("#" + self.uid + "-tick-" + sec.id).css("visibility", "hidden");
                }
            }
        });

        // Update per-step visual states (grayed / active / completed)
        self._updateTeacherStepStates(savedCompletedRows, savedCompletedSections);

        // Update correct answers panel — remove completed inputs
        self._renderCorrectAnswersPanelDynamic(savedCompletedRows, savedCompletedSections);
    };

    // ═════════════════════════════════════════════════
    // v3: ENABLE / DISABLE
    // ═════════════════════════════════════════════════

    Question.prototype.enable = function () {
        this._disabled = false;
        this.$el.find(".req-widget").removeClass("req-review-mode");
        this.$el.find(".req-check-btn").prop("disabled", false);
    };

    Question.prototype.disable = function () {
        this._disabled = true;
        this.$el.find(".req-widget").addClass("req-review-mode");
        this.$el.find(".req-check-btn").prop("disabled", true);
    };

    // ── Symbol keypad ──
    Question.prototype.buildKeypad = function ($container) {
        var self = this;
        var $keypad = $('<div class="req-keypad" id="' + self.uid + '-keypad"></div>');

        var keys = [
            { label: "+", cmd: "+", type: "write" },
            { label: "-", cmd: "-", type: "write" },
            { label: "\\times", cmd: "\\times", type: "cmd" },
            { label: "\\div", cmd: "\\div", type: "cmd" },
            { label: "=", cmd: "=", type: "write" },
            { label: "(\\,)", cmd: "(", type: "write", extra: ")" },
            { label: ",", cmd: ",", type: "write" },
            { label: "x^{\\square}", cmd: "^", type: "cmd" },
            { label: "\\dfrac{\\square}{\\square}", cmd: "/", type: "cmd" },
            { label: "\\sqrt{\\square}", cmd: "\\sqrt", type: "cmd" },
            { label: "\\ln", cmd: "\\ln", type: "cmd" },
            { label: "\\log", cmd: "\\log", type: "cmd" },
            { label: "\\log_{\\square}", cmd: "\\log_", type: "cmd" },
            { label: "i", cmd: "i", type: "write" },
            { label: "x", cmd: "x", type: "write" }
        ];

        keys.forEach(function (k) {
            if (k.type === "sep") {
                $keypad.append($('<div class="req-keypad-sep"></div>'));
                return;
            }
            var $btn = $('<button class="req-keypad-btn"></button>');
            try {
                $btn.html(katex.renderToString(k.label, { throwOnError: false }));
            } catch (e) { $btn.text(k.label); }

            $btn.on("mousedown", function (ev) {
                ev.preventDefault();
                if (!self.focusedMQField) return;
                if (k.type === "cmd") self.focusedMQField.cmd(k.cmd);
                else self.focusedMQField.write(k.cmd);
                if (k.extra) self.focusedMQField.write(k.extra);
                self.focusedMQField.focus();
            });

            $keypad.append($btn);
        });

        $container.append($keypad);
    };

    Question.prototype.setupKeypadForField = function (field, slot) {
        var self = this;
        $(slot).on("focusin", function () {
            self.focusedMQField = field;
            var $keypad = $("#" + self.uid + "-keypad");
            $keypad.addClass("visible");

            var $slot = $(slot);
            var $widget = self.$el.find(".req-widget");
            var widgetOff = $widget.offset();
            if (!widgetOff) return;

            // Find the expression cell (first td in row, or the twi content area)
            var $row = $slot.closest("tr, .req-twi-flex");
            var $exprCell = $row.find("td:first");
            if (!$exprCell.length) $exprCell = $row; // fallback for twi sections
            var cellOff = $exprCell.offset();
            var cellRight = cellOff ? cellOff.left + $exprCell.outerWidth() : 0;
            var cellBottom = cellOff ? cellOff.top + $exprCell.outerHeight() : 0;

            // Diagonally below-right of the expression's right edge
            var top = cellBottom - widgetOff.top + 4;
            var left = cellRight - widgetOff.left + 8;

            // Clamp so keypad stays within widget
            var keypadW = $keypad.outerWidth() || 220;
            var widgetW = $widget.outerWidth() || 700;
            if (left + keypadW > widgetW) left = Math.max(0, widgetW - keypadW - 8);

            $keypad.css({ top: top + "px", left: left + "px" });
        });
    };

    // ═════════════════════════════════════════════════
    // SCORER CLASS (inline, for client-side)
    // ═════════════════════════════════════════════════

    function Scorer(question, response) {
        this.question = question;
        this.response = response;
    }

    Scorer.prototype.isValid = function () {
        return this.response && this.response.value;
    };

    Scorer.prototype.score = function () {
        var val = this.response ? this.response.value : null;
        if (!val) return 0;
        if (typeof val === "object") val = val.progress || "0/1";
        var parts = val.split("/");
        var completed = parseInt(parts[0]) || 0;
        var total = parseInt(parts[1]) || 1;
        if (completed >= total) return this.maxScore();
        return Math.round((completed / total) * this.maxScore());
    };

    Scorer.prototype.maxScore = function () {
        return this.question.score || 1;
    };

    return { Question: Question, Scorer: Scorer };
});
