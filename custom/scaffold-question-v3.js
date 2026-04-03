/*
 * Learnosity Custom Question — Progressive Scaffold Reveal v3
 *
 * v3 additions over v1:
 *  - Rich response format: includes all input values + per-input correctness
 *  - Resume mode: restores student progress on page refresh
 *  - Review mode: shows all answers to teachers, correct/incorrect markers
 *  - Correct Answers panel: numbered boxes with expected answers
 *  - Teacher detection via LEAP URL
 *  - enable()/disable() for Learnosity interactivity toggling
 *
 * Custom type: "progressive_scaffold"
 */
LearnosityAmd.define(["jquery-v1.10.2"], function ($) {
    "use strict";

    var KATEX_CSS = "https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/katex.min.css";
    var KATEX_JS  = "https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/katex.min.js";
    var KATEX_AUTO = "https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/contrib/auto-render.min.js";

    function ScaffoldQuestion(init, lrnUtils) {
        this.init = init;
        this.lrnUtils = lrnUtils;
        this.question = init.question || {};
        this.response = init.response || {};
        this.$el = $(init.$el);
        this.scaffolds = this.question.scaffolds || [];
        this.currentScaffold = 0;
        this.enabled = true;
        this.state = init.state || "initial";
        this.uid = "sq-" + Math.random().toString(36).slice(2, 8);

        // Detect teacher mode from LEAP URL
        this.isTeacher = (window.location.href || "").indexOf("worksheet-teacher") >= 0;

        // Determine how far the student got from saved response
        if (this.response && this.response.completedScaffolds) {
            this.currentScaffold = Math.min(
                this.response.completedScaffolds,
                this.scaffolds.length
            );
        }

        // Render immediately, fire ready synchronously, then load KaTeX async
        this._render();
        this._bindEvents();
        this._updateState();
        init.events.trigger("ready");

        // Load KaTeX in the background and then apply the appropriate mode
        var self = this;
        this._loadKaTeX(function () {
            if (self.isTeacher || self.state === "review") {
                self._applyReviewMode();
                self._renderCorrectAnswersPanel();
            } else if (self.state === "resume") {
                self._restoreFromResponse();
            }
        });
    }

    ScaffoldQuestion.prototype._loadKaTeX = function (callback) {
        var self = this;
        var cb = callback || function () {};

        if (window.katex && window.renderMathInElement) {
            self._renderMath();
            setTimeout(cb, 50);
            return;
        }

        // Load CSS
        if (!$('link[href*="katex"]').length) {
            $("head").append('<link rel="stylesheet" href="' + KATEX_CSS + '">');
        }

        // Load JS then auto-render
        $.getScript(KATEX_JS)
            .done(function () {
                $.getScript(KATEX_AUTO)
                    .done(function () {
                        self._renderMath();
                        setTimeout(cb, 50);
                    })
                    .fail(function () { console.warn("[scaffold-q-v3] auto-render load failed"); cb(); });
            })
            .fail(function () { console.warn("[scaffold-q-v3] KaTeX load failed"); cb(); });
    };

    ScaffoldQuestion.prototype._render = function () {
        var q = this.question;
        var html = '<div class="scaffold-q" id="' + this.uid + '-widget">';

        // Header
        html += '<div class="sq-header">';
        html += '<div class="sq-stimulus">' + (q.stimulus || '') + '</div>';
        if (q.given_values) {
            html += '<div class="sq-given">' + q.given_values + '</div>';
        }
        html += '</div>';

        // Scaffold containers
        for (var i = 0; i < this.scaffolds.length; i++) {
            var sc = this.scaffolds[i];
            var state = i < this.currentScaffold ? 'completed' :
                        i === this.currentScaffold ? 'active' : 'locked';
            html += '<div class="sq-scaffold ' + state + '" data-idx="' + i + '" id="' + this.uid + '-scaffold-' + i + '">';
            html += '<div class="sq-scaffold-header">';
            html += '<span class="sq-badge">' + (i + 1) + '</span>';
            html += '<span class="sq-scaffold-title">' + (sc.title || 'Part ' + String.fromCharCode(97 + i)) + '</span>';
            if (state === 'completed') {
                html += '<span class="sq-check">&#10003;</span>';
            }
            html += '</div>';
            html += '<div class="sq-scaffold-body">';
            html += this._renderScaffoldContent(sc, i, state);
            html += '</div>';
            html += '</div>';
        }

        // Completion message
        html += '<div class="sq-done" id="' + this.uid + '-done" style="display:none;">All parts complete! Score: <span class="sq-score"></span></div>';

        html += '</div>';
        this.$el.html(html);
    };

    ScaffoldQuestion.prototype._renderScaffoldContent = function (sc, idx, state) {
        var html = '';

        if (sc.problem) {
            html += '<div class="sq-problem">' + sc.problem + '</div>';
        }

        if (sc.steps && sc.steps.length) {
            html += '<table class="sq-table">';
            html += '<thead><tr><th>Expression</th><th>Result</th><th>Reason</th></tr></thead>';
            html += '<tbody>';
            for (var j = 0; j < sc.steps.length; j++) {
                var step = sc.steps[j];
                html += '<tr>';
                html += '<td>' + (step.expression || '') + '</td>';
                html += '<td>';
                if (step.inputs) {
                    for (var k = 0; k < step.inputs.length; k++) {
                        var inp = step.inputs[k];
                        var savedVal = '';
                        if (this.response && this.response.scaffolds &&
                            this.response.scaffolds[idx] &&
                            this.response.scaffolds[idx]['s' + j + '_' + k] !== undefined) {
                            savedVal = this.response.scaffolds[idx]['s' + j + '_' + k];
                        }
                        var inputId = this.uid + '-inp-' + idx + '-' + j + '-' + k;
                        html += '<span class="sq-math-inline">' + (inp.before || '') + '</span>';
                        html += '<input type="text" class="sq-input" ';
                        html += 'id="' + inputId + '" ';
                        html += 'data-scaffold="' + idx + '" ';
                        html += 'data-step="' + j + '" ';
                        html += 'data-input="' + k + '" ';
                        html += 'data-answer="' + this._escapeAttr(inp.answer) + '" ';
                        html += 'value="' + this._escapeAttr(savedVal) + '" ';
                        html += 'placeholder="?" ';
                        if (state === 'locked' || state === 'completed' || !this.enabled) {
                            html += 'disabled ';
                        }
                        html += '/>';
                        html += '<span class="sq-math-inline">' + (inp.after || '') + '</span>';
                    }
                } else {
                    html += step.result || '';
                }
                html += '</td>';
                html += '<td class="sq-reason">' + (step.reason || '') + '</td>';
                html += '</tr>';
            }
            html += '</tbody></table>';
        }

        html += '<div class="sq-actions" id="' + this.uid + '-actions-' + idx + '">';
        html += '<button class="sq-btn sq-check-btn" data-idx="' + idx + '"';
        if (state !== 'active' || !this.enabled) html += ' disabled';
        html += '>Check</button>';
        html += '<div class="sq-fb" data-idx="' + idx + '"></div>';
        html += '</div>';

        if (sc.hint) {
            html += '<div class="sq-hint-toggle">';
            html += '<button class="sq-hint-btn" data-idx="' + idx + '">Show Hint</button>';
            html += '</div>';
            html += '<div class="sq-hint" data-idx="' + idx + '" style="display:none;">' + sc.hint + '</div>';
        }

        return html;
    };

    ScaffoldQuestion.prototype._escapeAttr = function (str) {
        return String(str || '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    };

    ScaffoldQuestion.prototype._renderMath = function () {
        try {
            if (window.renderMathInElement) {
                renderMathInElement(this.$el[0], {
                    delimiters: [
                        { left: "$$", right: "$$", display: true },
                        { left: "$", right: "$", display: false }
                    ],
                    throwOnError: false
                });
            }
        } catch (e) {
            console.warn("[scaffold-q-v3] math render error:", e);
        }
    };

    ScaffoldQuestion.prototype._bindEvents = function () {
        var self = this;

        this.$el.on("click", ".sq-check-btn", function () {
            var idx = parseInt($(this).attr("data-idx"));
            self._checkScaffold(idx);
        });

        this.$el.on("click", ".sq-hint-btn", function () {
            var idx = $(this).attr("data-idx");
            var $hint = self.$el.find('.sq-hint[data-idx="' + idx + '"]');
            $hint.toggle();
            $(this).text($hint.is(":visible") ? "Hide Hint" : "Show Hint");
        });

        this.$el.on("input", ".sq-input", function () {
            self._saveCurrentResponse();
            self.init.events.trigger("changed", self.getResponse());
        });

        this.$el.on("keydown", ".sq-input", function (e) {
            if (e.key === "Enter") {
                var idx = parseInt($(this).attr("data-scaffold"));
                self._checkScaffold(idx);
            }
        });
    };

    ScaffoldQuestion.prototype._checkScaffold = function (idx) {
        if (idx !== this.currentScaffold) return;

        var $scaffold = this.$el.find('.sq-scaffold[data-idx="' + idx + '"]');
        var allCorrect = true;
        var anyFilled = false;

        $scaffold.find(".sq-input").each(function () {
            var $inp = $(this);
            var userVal = $.trim($inp.val());
            var answer = $inp.attr("data-answer");
            var answers = answer.split("|");

            if (!userVal) { allCorrect = false; return; }
            anyFilled = true;

            var correct = false;
            for (var a = 0; a < answers.length; a++) {
                var expected = $.trim(answers[a]);
                var normUser = userVal.replace(/\s+/g, '').toLowerCase();
                var normExpected = expected.replace(/\s+/g, '').toLowerCase();
                if (normUser === normExpected) { correct = true; break; }
                var numUser = parseFloat(userVal);
                var numExpected = parseFloat(expected);
                if (!isNaN(numUser) && !isNaN(numExpected) && Math.abs(numUser - numExpected) < 0.001) { correct = true; break; }
            }

            $inp.removeClass("wrong correct").addClass(correct ? "correct" : "wrong");
            if (!correct) allCorrect = false;
        });

        var $fb = this.$el.find('.sq-fb[data-idx="' + idx + '"]');

        if (!anyFilled) {
            $fb.attr("class", "sq-fb wrong").text("Fill in all blanks before checking.").show();
            return;
        }

        if (allCorrect) {
            $fb.attr("class", "sq-fb correct").text("Correct!").show();
            $scaffold.removeClass("active").addClass("completed");
            $scaffold.find(".sq-input").prop("disabled", true);
            $scaffold.find(".sq-check-btn").prop("disabled", true);
            $scaffold.find(".sq-scaffold-header").append('<span class="sq-check">&#10003;</span>');

            this.currentScaffold = idx + 1;
            this._saveCurrentResponse();

            if (this.currentScaffold < this.scaffolds.length) {
                var $next = this.$el.find('.sq-scaffold[data-idx="' + this.currentScaffold + '"]');
                $next.removeClass("locked").addClass("active");
                $next.find(".sq-input").prop("disabled", false);
                $next.find(".sq-check-btn").prop("disabled", false);
                this._renderMath();
                $next[0].scrollIntoView({ behavior: "smooth", block: "nearest" });
            } else {
                var score = this._computeScore();
                this.$el.find(".sq-done").show().find(".sq-score").text(
                    score + " / " + (this.question.score || this.scaffolds.length)
                );
            }

            this.init.events.trigger("changed", this.getResponse());
        } else {
            $fb.attr("class", "sq-fb wrong").text("Some answers are incorrect. Try again.").show();
        }
    };

    ScaffoldQuestion.prototype._saveCurrentResponse = function () {
        var resp = { scaffolds: {}, completedScaffolds: this.currentScaffold };
        this.$el.find(".sq-input").each(function () {
            var $inp = $(this);
            var si = $inp.attr("data-scaffold");
            var key = "s" + $inp.attr("data-step") + "_" + $inp.attr("data-input");
            if (!resp.scaffolds[si]) resp.scaffolds[si] = {};
            resp.scaffolds[si][key] = $inp.val();
        });
        this.response = resp;
    };

    ScaffoldQuestion.prototype._computeScore = function () {
        var correct = 0;
        this.$el.find(".sq-input").each(function () {
            if ($(this).hasClass("correct")) correct++;
        });
        return correct;
    };

    ScaffoldQuestion.prototype._updateState = function () {
        if (this.currentScaffold >= this.scaffolds.length) {
            this.$el.find(".sq-done").show();
        }
    };

    // ═══════════════════════════════════════════════
    // v3: RICH RESPONSE FORMAT
    // ═══════════════════════════════════════════════

    ScaffoldQuestion.prototype.collectAllInputValues = function () {
        var self = this;
        var inputs = {};

        for (var i = 0; i < self.scaffolds.length; i++) {
            var sc = self.scaffolds[i];
            var scaffoldCompleted = i < self.currentScaffold;
            var steps = sc.steps || [];

            for (var j = 0; j < steps.length; j++) {
                var stepInputs = steps[j].inputs;
                if (!stepInputs) continue;

                for (var k = 0; k < stepInputs.length; k++) {
                    var key = i + "-" + j + "-" + k;
                    var inputId = self.uid + '-inp-' + i + '-' + j + '-' + k;
                    var el = document.getElementById(inputId);
                    var val = el ? $.trim(el.value) : '';

                    var correct = scaffoldCompleted;
                    if (!correct && val) {
                        var answer = stepInputs[k].answer;
                        var answers = answer.split("|");
                        for (var a = 0; a < answers.length; a++) {
                            var expected = $.trim(answers[a]);
                            var normUser = val.replace(/\s+/g, '').toLowerCase();
                            var normExpected = expected.replace(/\s+/g, '').toLowerCase();
                            if (normUser === normExpected) { correct = true; break; }
                            var numUser = parseFloat(val);
                            var numExpected = parseFloat(expected);
                            if (!isNaN(numUser) && !isNaN(numExpected) && Math.abs(numUser - numExpected) < 0.001) { correct = true; break; }
                        }
                    }

                    inputs[key] = { value: val, correct: correct };
                }
            }
        }

        return inputs;
    };

    ScaffoldQuestion.prototype.getResponse = function () {
        var self = this;
        var totalScaffolds = self.scaffolds.length;
        var completedScaffolds = self.currentScaffold;

        // Build scaffolds map (backward compat)
        var scaffoldsMap = {};
        self.$el.find(".sq-input").each(function () {
            var $inp = $(this);
            var si = $inp.attr("data-scaffold");
            var key = "s" + $inp.attr("data-step") + "_" + $inp.attr("data-input");
            if (!scaffoldsMap[si]) scaffoldsMap[si] = {};
            scaffoldsMap[si][key] = $inp.val();
        });

        return {
            value: completedScaffolds + "/" + totalScaffolds,
            type: "object",
            apiVersion: "v3",
            scaffolds: scaffoldsMap,
            completedScaffolds: completedScaffolds,
            inputs: self.collectAllInputValues()
        };
    };

    // ═══════════════════════════════════════════════
    // v3: RESUME MODE
    // ═══════════════════════════════════════════════

    ScaffoldQuestion.prototype._restoreFromResponse = function () {
        var self = this;
        var response = self.response;

        if (!response || !response.inputs) {
            // No rich state — fall back to what the constructor already did
            return;
        }

        // The constructor already set currentScaffold from completedScaffolds
        // and populated input values from response.scaffolds.
        // Now replay the visual state:
        for (var i = 0; i < self.scaffolds.length; i++) {
            var $scaffold = self.$el.find('.sq-scaffold[data-idx="' + i + '"]');

            if (i < self.currentScaffold) {
                // Completed: mark correct, disable, show checkmark
                $scaffold.removeClass("locked active").addClass("completed");
                $scaffold.find(".sq-input").each(function () {
                    $(this).prop("disabled", true).addClass("correct").removeClass("wrong");
                });
                $scaffold.find(".sq-check-btn").prop("disabled", true);
                if (!$scaffold.find(".sq-check").length) {
                    $scaffold.find(".sq-scaffold-header").append('<span class="sq-check">&#10003;</span>');
                }
            } else if (i === self.currentScaffold) {
                // Active: unlock for continued work
                $scaffold.removeClass("locked completed").addClass("active");
                $scaffold.find(".sq-input").prop("disabled", false);
                $scaffold.find(".sq-check-btn").prop("disabled", false);
            } else {
                // Still locked
                $scaffold.removeClass("active completed").addClass("locked");
            }
        }

        self.init.events.trigger("changed", self.getResponse());
    };

    // ═══════════════════════════════════════════════
    // v3: REVIEW MODE (teacher view)
    // ═══════════════════════════════════════════════

    ScaffoldQuestion.prototype._applyReviewMode = function () {
        var self = this;
        var savedInputs = (self.response && self.response.inputs) ? self.response.inputs : {};

        // Add review mode class
        self.$el.find(".scaffold-q").addClass("sq-review-mode");

        // Unlock ALL scaffolds
        for (var i = 0; i < self.scaffolds.length; i++) {
            var $scaffold = self.$el.find('.sq-scaffold[data-idx="' + i + '"]');
            $scaffold.removeClass("locked active").addClass("completed");
        }

        // Populate input values from saved response
        for (var key in savedInputs) {
            var saved = savedInputs[key];
            var parts = key.split("-");
            var inputId = self.uid + '-inp-' + parts[0] + '-' + parts[1] + '-' + parts[2];
            var el = document.getElementById(inputId);
            if (el && saved.value) {
                el.value = saved.value;
            }
        }

        // Mark correct/incorrect — only if student typed something
        for (var key2 in savedInputs) {
            var saved2 = savedInputs[key2];
            if (!saved2.value) continue;
            var parts2 = key2.split("-");
            var inputId2 = self.uid + '-inp-' + parts2[0] + '-' + parts2[1] + '-' + parts2[2];
            var el2 = document.getElementById(inputId2);
            if (el2) {
                $(el2).removeClass("correct wrong").addClass(saved2.correct ? "correct" : "wrong");
            }
        }

        // Disable all inputs
        self.$el.find(".sq-input").prop("disabled", true);

        // Add numbered badges to inputs
        var inputNum = 0;
        for (var si = 0; si < self.scaffolds.length; si++) {
            var sc = self.scaffolds[si];
            var steps = sc.steps || [];
            for (var sj = 0; sj < steps.length; sj++) {
                var stepInputs = steps[sj].inputs;
                if (!stepInputs) continue;
                for (var sk = 0; sk < stepInputs.length; sk++) {
                    inputNum++;
                    var badgeInputId = self.uid + '-inp-' + si + '-' + sj + '-' + sk;
                    var $inp = $("#" + badgeInputId);
                    if ($inp.length) {
                        var $wrap = $inp.wrap('<span class="sq-input-badge-wrap"></span>').parent();
                        $wrap.prepend($('<span class="sq-num-badge"></span>').text(inputNum));
                    }
                }
            }
        }

        // Show scaffold completion checkmarks or crosses
        for (var ci = 0; ci < self.scaffolds.length; ci++) {
            var $sc = self.$el.find('.sq-scaffold[data-idx="' + ci + '"]');
            if (ci < self.currentScaffold) {
                if (!$sc.find(".sq-check").length) {
                    $sc.find(".sq-scaffold-header").append('<span class="sq-check">&#10003;</span>');
                }
            } else {
                // Incomplete scaffold — check if any inputs were filled
                var hasInput = false;
                $sc.find(".sq-input").each(function () {
                    if ($(this).val()) hasInput = true;
                });
                if (hasInput) {
                    $sc.find(".sq-scaffold-header").append('<span class="sq-check" style="color:#e8883a;">&#10007;</span>');
                }
            }
        }

        // Hide all Check buttons and hints
        self.$el.find(".sq-check-btn").hide();
        self.$el.find(".sq-hint-btn").hide();
        self.$el.find(".sq-hint").hide();

        // Show done banner if all complete
        if (self.currentScaffold >= self.scaffolds.length) {
            self.$el.find(".sq-done").show();
        }
    };

    ScaffoldQuestion.prototype._renderCorrectAnswersPanel = function () {
        var self = this;
        var $panel = $('<div class="sq-correct-answers"></div>');
        var $title = $('<p class="sq-ca-title">Correct Answers</p>');
        var $grid = $('<div class="sq-ca-grid"></div>');
        var num = 0;

        for (var i = 0; i < self.scaffolds.length; i++) {
            var sc = self.scaffolds[i];
            var steps = sc.steps || [];
            for (var j = 0; j < steps.length; j++) {
                var stepInputs = steps[j].inputs;
                if (!stepInputs) continue;
                for (var k = 0; k < stepInputs.length; k++) {
                    num++;
                    var answer = stepInputs[k].answer;
                    // For pipe-separated answers, show first option
                    var displayAnswer = answer.split("|")[0];

                    var $box = $('<div class="sq-ca-box"></div>');
                    $box.append($('<span class="sq-num-badge"></span>').text(num));
                    var $val = $('<span></span>');

                    // Try to render as math if it looks like a number or expression
                    try {
                        if (window.katex) {
                            $val.html(katex.renderToString(displayAnswer, { throwOnError: false }));
                        } else {
                            $val.text(displayAnswer);
                        }
                    } catch (e) {
                        $val.text(displayAnswer);
                    }

                    $box.append($val);
                    $grid.append($box);
                }
            }
        }

        if (num > 0) {
            $panel.append($title).append($grid);
            self.$el.find(".scaffold-q").append($panel);
        }
    };

    // ═══════════════════════════════════════════════
    // v3: ENABLE / DISABLE
    // ═══════════════════════════════════════════════

    ScaffoldQuestion.prototype.enable = function () {
        this.enabled = true;
        this.$el.find(".scaffold-q").removeClass("sq-review-mode");
        this.$el.find(".sq-scaffold.active .sq-input").prop("disabled", false);
        this.$el.find(".sq-scaffold.active .sq-check-btn").prop("disabled", false);
    };

    ScaffoldQuestion.prototype.disable = function () {
        this.enabled = false;
        this.$el.find(".scaffold-q").addClass("sq-review-mode");
        this.$el.find(".sq-input").prop("disabled", true);
        this.$el.find(".sq-check-btn").prop("disabled", true);
    };

    ScaffoldQuestion.prototype.resetResponse = function () {
        this.response = {};
        this.currentScaffold = 0;
        this._render();
        this._bindEvents();
        this._loadKaTeX();
    };

    return {
        Question: ScaffoldQuestion
    };
});
