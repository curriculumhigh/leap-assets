/*
 * Learnosity Custom Question — Progressive Scaffold Reveal
 * Renders a multi-scaffold problem where each scaffold unlocks after the previous is correct.
 * Uses KaTeX for math rendering (loaded async after ready).
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

        // Load KaTeX in the background and re-render math when ready
        this._loadKaTeX();
    }

    ScaffoldQuestion.prototype._loadKaTeX = function () {
        var self = this;
        if (window.katex && window.renderMathInElement) {
            self._renderMath();
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
                    .done(function () { self._renderMath(); })
                    .fail(function () { console.warn("[scaffold-q] auto-render load failed"); });
            })
            .fail(function () { console.warn("[scaffold-q] KaTeX load failed"); });
    };

    ScaffoldQuestion.prototype._render = function () {
        var q = this.question;
        var html = '<div class="scaffold-q">';

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
            html += '<div class="sq-scaffold ' + state + '" data-idx="' + i + '">';
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
        html += '<div class="sq-done" style="display:none;">All parts complete! Score: <span class="sq-score"></span></div>';

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
                        html += '<span class="sq-math-inline">' + (inp.before || '') + '</span>';
                        html += '<input type="text" class="sq-input" ';
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

        html += '<div class="sq-actions">';
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
            console.warn("[scaffold-q] math render error:", e);
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

            this.init.events.trigger("changed", this.response);
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

    ScaffoldQuestion.prototype.enable = function () {
        this.enabled = true;
        this.$el.find(".sq-scaffold.active .sq-input").prop("disabled", false);
        this.$el.find(".sq-scaffold.active .sq-check-btn").prop("disabled", false);
    };

    ScaffoldQuestion.prototype.disable = function () {
        this.enabled = false;
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
