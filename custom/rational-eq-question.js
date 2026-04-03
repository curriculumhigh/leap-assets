/**
 * Rational Equation — Learnosity Custom Question
 *
 * Renders a multi-section rational equation activity with:
 *  - MathQuill (FM) inputs for algebraic solving in equation tables
 *  - Dropdown (DN) inputs for extraneous solution checks
 *  - Sequential section/row unlocking
 *  - Nerdamer-based symbolic validation (equivSymbolic, setEquiv)
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

    function loadDeps() {
        loadCSS(CDN.katexCSS);
        loadCSS(CDN.mqCSS);
        // Load scripts sequentially using $.getScript (matches scaffold POC pattern)
        return $.getScript(CDN.katexJS)
            .then(function () { return $.getScript(CDN.katexAuto); })
            .then(function () { return $.getScript(CDN.mqJS); })
            .then(function () { return $.getScript(CDN.nerdCore); })
            .then(function () { return $.getScript(CDN.nerdAlg); })
            .then(function () { return $.getScript(CDN.nerdCalc); })
            .then(function () { return $.getScript(CDN.nerdSolve); })
            .then(function () { return $.getScript(CDN.nerdExtra); });
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

        // Internal state
        this.MQ = null;
        this.mqFields = {};
        this.completedSections = {};
        this.completedRows = {};
        this.unlockedRows = {};
        this.focusedMQField = null;
        this.uid = "req-" + Math.random().toString(36).slice(2, 8);

        // Fire ready immediately so Learnosity doesn't time out,
        // then load CDN deps and render async
        init.events.trigger("ready");

        // Wire Learnosity's "Check Answer" button validate event
        var self = this;
        init.events.on("validate", function () { self.validateCurrentStep(); });

        loadDeps().then(function () {
            self.MQ = MathQuill.getInterface(2);
            self.render();
        });
    }

    Question.prototype.render = function () {
        var q = this.question;
        var self = this;

        var $w = $('<div class="req-widget" style="position:relative;"></div>');

        // Render stimulus ourselves with KaTeX (using question_stimulus to avoid
        // Learnosity's raw auto-rendering of the standard `stimulus` field)
        var stim = q.question_stimulus || q.stimulus || "";
        if (stim) {
            $w.append($('<p style="font-size:15px;line-height:1.7;margin:0 0 14px;"></p>').html(stim));
        }

        // Sections — grouped by `group` field into scaffold-block wrappers
        var sections = q.sections || [];
        var currentGroup = null;
        var $currentGroupDiv = null;
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
                if (sec.group !== currentGroup) {
                    currentGroup = sec.group;
                    $currentGroupDiv = $('<div class="req-scaffold-block" id="' + self.uid + '-group-' + sec.group + '"></div>');
                    self.groupFirstIndex[sec.group] = si;
                    if (si > 0) $currentGroupDiv.addClass("req-section-locked");
                    $w.append($currentGroupDiv);
                }
                if (si !== self.groupFirstIndex[sec.group]) {
                    $sec.addClass("req-section-locked");
                }
                $currentGroupDiv.append($sec);
            } else {
                currentGroup = null;
                $currentGroupDiv = null;
                if (si > 0) $sec.addClass("req-section-locked");
                $w.append($sec);
            }
        });

        // Done banner
        $w.append($('<div class="req-done" id="' + self.uid + '-done">All steps complete!</div>'));

        // Hint
        if (q.hint) {
            var $hint = $('<div style="margin-top:12px"></div>');
            var $btn = $('<button class="req-hint-btn">Show Hint</button>');
            var $box = $('<div class="req-hint-box"></div>').html(q.hint);
            $btn.on("click", function () { $box.toggleClass("visible"); });
            $hint.append($btn).append($box);
            $w.append($hint);
        }

        // Feedback label for Learnosity's item-level "Check Answers" button.
        // That button is rendered by the Items API (outside the widget) and fires
        // the validate event — our handler shows feedback here.
        var $caFb = $('<span class="req-ca-feedback" id="' + self.uid + '-ca-fb"></span>');
        $w.append($caFb);

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

        // Unlock first section
        self.unlockSection(0);
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
            throwOnError: false
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
        s = s.replace(/\\ln\b/g, "log");
        s = s.replace(/\\log_\{([^{}]+)\}\s*\(([^()]+)\)/g, "(log($2)/log($1))");
        s = s.replace(/\\log_\{([^{}]+)\}\s*([a-zA-Z0-9])/g, "(log($2)/log($1))");
        s = s.replace(/\\log\b/g, "log");
        s = s.replace(/\^{([^{}]+)}/g, "^($1)");
        s = s.replace(/_\{([^{}]+)\}/g, "_($1)");
        s = s.replace(/(\d)([a-zA-Z])/g, "$1*$2");
        s = s.replace(/\\(?!pi|e|sqrt|ln|log|sin|cos|tan|infty)/g, "");
        return s;
    };

    Question.prototype.checkEquivSymbolic = function (studentLatex, expectedNerdamer) {
        try {
            var studentExpr = this.latexToNerdamer(studentLatex);
            if (!studentExpr.trim()) return false;
            var diff = nerdamer("simplify((" + studentExpr + ")-(" + expectedNerdamer + "))");
            return diff.toString() === "0";
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
        if (inputSpec.method === "setEquiv") return this.checkSetEquiv(studentLatex, inputSpec.answer);
        return this.checkEquivSymbolic(studentLatex, inputSpec.answer);
    };

    // ── Section builders ──
    Question.prototype.buildTextSection = function (sec) {
        var $div = $('<div id="' + this.uid + '-sec-' + sec.id + '"></div>');
        $div.append($("<p></p>").html(sec.content));
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

            // Expression cell
            var $tdExpr = $("<td></td>");
            if (row.inputs && row.inputs.length > 0) {
                self.buildTemplateExpression($tdExpr, row, sec.id, ri);
            } else {
                $tdExpr.html("$" + row.expression + "$");
            }
            $tr.append($tdExpr);

            // Annotation cell
            $tr.append($('<td class="req-annotation"></td>').text(row.annotation));

            // Feedback cell
            $tr.append($('<td class="req-fb-cell" id="' + self.uid + '-fb-' + sec.id + '-' + ri + '"></td>'));

            $tbody.append($tr);

            // Button row
            if (row.inputs && row.inputs.length > 0) {
                var $trBtn = $('<tr class="req-eq-row locked" id="' + self.uid + '-rowbtn-' + sec.id + '-' + ri + '"></tr>');
                var $tdE = $("<td colspan='3'></td>");
                var $actions = $('<div class="req-actions"></div>');

                var $btn = $('<button class="req-check-btn">Check</button>');
                (function (secRef, rowIdx) {
                    $btn.on("click", function () { self.checkRowAnswer(secRef, rowIdx); });
                })(sec, ri);
                $actions.append($btn);

                var $fb = $('<span class="req-fb" id="' + self.uid + '-fbpill-' + sec.id + '-' + ri + '"></span>');
                $actions.append($fb);

                $tdE.append($actions);
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

        var parts = sec.template.split(/(\{\{\d+\}\})/);
        var $p = $("<p style='font-size:15px;line-height:1.7;margin:0 0 10px;'></p>");

        parts.forEach(function (part) {
            var match = part.match(/\{\{(\d+)\}\}/);
            if (match) {
                var inputIdx = parseInt(match[1]);
                var inp = sec.inputs[inputIdx];

                if (inp && inp.type === "dropdown") {
                    var $select = $('<select class="req-dropdown" id="' + self.uid + '-dd-' + sec.id + '-' + inputIdx + '"></select>');
                    $select.append($('<option value="" disabled selected>Select\u2026</option>'));
                    inp.options.forEach(function (opt) {
                        $select.append($("<option></option>").val(opt).text(opt));
                    });
                    $p.append($select);
                } else {
                    var $mqSpan = $('<span class="mq-slot" id="' + self.uid + '-mq-' + sec.id + '-' + inputIdx + '" style="display:inline-block;min-width:70px;vertical-align:middle;"></span>');
                    $p.append($mqSpan);
                }
            } else if (part.trim()) {
                $p.append($("<span></span>").html(part));
            }
        });

        $content.append($p);

        // Actions row
        var $actions = $('<div class="req-actions" id="' + self.uid + '-actions-' + sec.id + '"></div>');
        var $btn = $('<button class="req-check-btn">Check</button>');
        (function (secRef) {
            $btn.on("click", function () { self.checkSectionAnswer(secRef); });
        })(sec);
        $actions.append($btn);
        $actions.append($('<span class="req-fb" id="' + self.uid + '-fbpill-' + sec.id + '"></span>'));
        $content.append($actions);

        $wrapper.append($content);

        // Right: tick cell (like equation table fb-cell, on the right edge)
        var $tick = $('<div id="' + self.uid + '-tick-' + sec.id + '" style="width:28px;text-align:center;padding-top:6px;visibility:hidden;"></div>');
        $tick.html('<span style="color:#2E7D32;font-size:16px;">&#10003;</span>');
        $wrapper.append($tick);

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
                            enter: function () { self.checkSectionAnswer(sec); }
                        }
                    });
                    self.mqFields[sec.id + "-" + inputIdx] = field;
                    self.setupKeypadForField(field, slot);
                }
            });
        });

        return $wrapper;
    };

    // ── Template expression builder (equation table rows) ──
    Question.prototype.buildTemplateExpression = function ($container, row, secId, rowIdx) {
        var self = this;
        var $wrapper = $('<span style="font-size:16px"></span>');

        if (row.htmlTemplate) {
            row.htmlTemplate.forEach(function (part) {
                if (part.sup !== undefined && part.inputIdx !== undefined) {
                    var $base = $("<span></span>").css("vertical-align", "middle").html("$" + part.text + "$");
                    $wrapper.append($base);

                    var $sup = $("<sup></sup>").css({ position: "relative", top: "-4px" });
                    if (part.supPrefix) {
                        var $pre = $("<span></span>").css("font-size", "13px");
                        $pre.html(part.supPrefix.indexOf("\\") >= 0 ? "$" + part.supPrefix + "$" : part.supPrefix);
                        $sup.append($pre);
                    }
                    var $mqSpan = $('<span class="mq-slot" id="' + self.uid + '-mq-' + secId + '-' + rowIdx + '-' + part.inputIdx + '" style="display:inline-block;min-width:50px;"></span>');
                    $sup.append($mqSpan);
                    if (part.supSuffix) {
                        var $suf = $("<span></span>").css("font-size", "13px");
                        $suf.html(part.supSuffix.indexOf("\\") >= 0 ? "$" + part.supSuffix + "$" : part.supSuffix);
                        $sup.append($suf);
                    }
                    $wrapper.append($sup);

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

        } else {
            var parts = row.template.split(/(\{\{\d+\}\})/);
            parts.forEach(function (part) {
                var match = part.match(/\{\{(\d+)\}\}/);
                if (match) {
                    var inputIdx = parseInt(match[1]);
                    var $mqSpan3 = $('<span class="mq-slot" id="' + self.uid + '-mq-' + secId + '-' + rowIdx + '-' + inputIdx + '" style="display:inline-block;min-width:60px;vertical-align:middle;"></span>');
                    $wrapper.append($mqSpan3);
                } else if (part.trim()) {
                    $wrapper.append($("<span></span>").css("vertical-align", "middle").html("$" + part + "$"));
                }
            });

            $container.append($wrapper);
            self.renderKaTeX($container[0]);
        }

        // Init MathQuill fields for this row
        requestAnimationFrame(function () {
            row.inputs.forEach(function (inp, inputIdx) {
                var slot = document.getElementById(self.uid + "-mq-" + secId + "-" + rowIdx + "-" + inputIdx);
                if (slot) {
                    var field = self.MQ.MathField(slot, {
                        spaceBehavesLikeTab: true,
                        handlers: {
                            enter: function () {
                                var sec = self.findSectionById(secId);
                                if (sec) self.checkRowAnswer(sec, rowIdx);
                            }
                        }
                    });
                    self.mqFields[secId + "-" + rowIdx + "-" + inputIdx] = field;
                    self.setupKeypadForField(field, slot);
                }
            });
        });
    };

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

        // If this section starts a new group, unlock the group wrapper
        if (sec.group && self.groupFirstIndex[sec.group] === idx) {
            $("#" + self.uid + "-group-" + sec.group).removeClass("req-section-locked");
        }

        // Unlock the section itself
        var $el = $("#" + self.uid + "-sec-" + sec.id);
        $el.removeClass("req-section-locked");

        if (sec.type === "text") {
            self.completedSections[sec.id] = true;
            requestAnimationFrame(function () { self.unlockSection(idx + 1); });
        } else if (sec.type === "equation-table") {
            self.initTableRows(sec);
        } else if (sec.type === "text-with-input") {
            // Focus first dropdown only (no auto-focus on FM to avoid showing keypad)
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
        var row = sec.rows[rowIdx];
        var allCorrect = true;

        if (row.validation === "equivEquation" && row.inputs.length === 2) {
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

        // Tick in feedback cell
        var $fb = $("#" + self.uid + "-fb-" + sec.id + "-" + rowIdx);
        $fb.html(allCorrect
            ? '<span style="color:#2E7D32;font-size:16px;">&#10003;</span>'
            : '<span style="color:#c62828;font-size:16px;">&#10007;</span>');

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
        var allCorrect = true;

        sec.inputs.forEach(function (inp, ii) {
            if (inp.type === "dropdown") {
                var select = document.getElementById(self.uid + "-dd-" + sec.id + "-" + ii);
                if (!select) return;
                var correct = select.value === inp.answer;
                $(select).removeClass("correct incorrect").addClass(correct ? "correct" : "incorrect");
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

        if (allCorrect) {
            self.completedSections[sec.id] = true;

            // Hide actions, show tick on right edge
            $("#" + self.uid + "-actions-" + sec.id).hide();
            $("#" + self.uid + "-tick-" + sec.id).css("visibility", "visible");

            // Disable inputs
            sec.inputs.forEach(function (inp, ii) {
                if (inp.type === "dropdown") {
                    var select = document.getElementById(self.uid + "-dd-" + sec.id + "-" + ii);
                    if (select) select.disabled = true;
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
        console.log("[rational-eq] validate event fired");
        var resp = self.getResponse();
        if (!resp || !resp.value) return;
        var parts = resp.value.split("/");
        var completed = parseInt(parts[0]) || 0;
        var total = parseInt(parts[1]) || 1;
        var allDone = completed >= total;

        // Ensure response is current for Scorer
        self.events.trigger("changed", resp);

        // Show visible feedback
        var $fb = $("#" + self.uid + "-ca-fb");
        if (allDone) {
            $fb.attr("class", "req-ca-feedback correct").text("Correct — all steps complete!");
        } else {
            $fb.attr("class", "req-ca-feedback incomplete")
               .text("Complete all steps first (" + completed + "/" + total + ")");
        }
    };

    // ── Response ──
    Question.prototype.getResponse = function () {
        var self = this;
        var sections = self.question.sections || [];
        var totalSteps = 0;
        var completedSteps = 0;

        sections.forEach(function (sec) {
            if (sec.type === "text") return; // no-input sections don't count
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

        return {
            value: completedSteps + "/" + totalSteps,
            type: "object",
            apiVersion: "v2.194.0"
        };
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

            // Position keypad below the focused field
            var $slot = $(slot);
            var widgetOff = self.$el.find(".req-widget").offset();
            var slotOff = $slot.offset();
            if (widgetOff && slotOff) {
                var top = slotOff.top - widgetOff.top + $slot.outerHeight() + 6;
                var left = slotOff.left - widgetOff.left;
                // Keep within widget bounds (max ~700px to leave margin within 766px)
                var keypadW = $keypad.outerWidth() || 280;
                var maxLeft = 700 - keypadW;
                if (left > maxLeft) left = Math.max(0, maxLeft);
                $keypad.css({ top: top + "px", left: left + "px" });
            }
        });
    };

    // ═════════════════════════════════════════════════
    // SCORER CLASS
    // ═════════════════════════════════════════════════

    function Scorer(question, response) {
        this.question = question;
        this.response = response;
    }

    Scorer.prototype.isValid = function () {
        return this.response && this.response.value;
    };

    Scorer.prototype.score = function () {
        if (!this.response || !this.response.value) return 0;
        var parts = this.response.value.split("/");
        var completed = parseInt(parts[0]) || 0;
        var total = parseInt(parts[1]) || 1;
        if (completed >= total) return this.maxScore();
        // Partial credit: proportional
        return Math.round((completed / total) * this.maxScore());
    };

    Scorer.prototype.maxScore = function () {
        return this.question.score || 1;
    };

    return { Question: Question, Scorer: Scorer };
});
