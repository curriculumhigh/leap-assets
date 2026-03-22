/*
 * Learnosity Custom Question — Polynomial Sketch Activity
 * Renders a step-by-step graphing activity using JSXGraph.
 */
LearnosityAmd.define(['jquery-v1.10.2'], function ($) {

    function Question(init, lrnUtils) {
        this.init = init;
        this.lrnUtils = lrnUtils;
        this.question = init.question;
        this.response = init.response || {};
        this.$el = $(init.$el);
        this.events = init.events;
        this.currentStep = 1;

        this.render();
        this.setupGraph();
        this.bindEvents();

        // Restore previous response if resuming
        if (init.state === 'resume' && this.response.completedSteps) {
            this.restoreState();
        }

        init.events.trigger('ready');
    }

    Question.prototype.render = function () {
        var q = this.question;
        var fn = q.fn_display || 'f(x)';
        var factored = q.factored_display || '';
        var leadingTerm = q.leading_term || '';

        this.$el.html(
            '<div class="poly-sketch">' +
            '  <div class="ps-header">Draw a rough sketch of <span class="fn">' + fn + '</span> step by step.</div>' +
            '  <div class="ps-board" id="ps-board-' + this._uid() + '"></div>' +

            // Step 1
            '  <div class="ps-step active" id="ps-s1-' + this._uid() + '">' +
            '    <div class="ps-step-header"><span class="ps-badge">1</span> Apply the leading coefficient test and determine the end behavior.</div>' +
            '    <div class="ps-step-body">' +
            '      <p style="margin-bottom:8px">The leading term is <b>' + leadingTerm + '</b>. Based on the degree and sign of the leading coefficient:</p>' +
            '      <div class="ps-input-row"><label>As x \u2192 \u2212\u221e, f(x) \u2192</label>' +
            '        <select class="ps-s1-left"><option value="">Select...</option><option value="+inf">+\u221e (up)</option><option value="-inf">\u2212\u221e (down)</option></select></div>' +
            '      <div class="ps-input-row"><label>As x \u2192 +\u221e, f(x) \u2192</label>' +
            '        <select class="ps-s1-right"><option value="">Select...</option><option value="+inf">+\u221e (up)</option><option value="-inf">\u2212\u221e (down)</option></select></div>' +
            '      <button class="ps-btn ps-check-1">Check</button>' +
            '      <div class="ps-fb" id="ps-fb1-' + this._uid() + '"></div>' +
            '    </div>' +
            '  </div>' +

            // Step 2
            '  <div class="ps-step locked" id="ps-s2-' + this._uid() + '">' +
            '    <div class="ps-step-header"><span class="ps-badge">2</span> Find the real zeros by factoring.</div>' +
            '    <div class="ps-step-body">' +
            '      <p style="margin-bottom:4px">Factored form: <b>' + factored + '</b></p>' +
            '      <p style="margin:8px 0">Enter the zeros (smallest first):</p>' +
            '      <div class="ps-input-row"><label>Zero 1: x =</label><input type="text" class="ps-s2-z1" placeholder="?"><label style="min-width:auto">multiplicity</label><input type="text" class="ps-s2-m1" placeholder="?" style="width:50px"></div>' +
            '      <div class="ps-input-row"><label>Zero 2: x =</label><input type="text" class="ps-s2-z2" placeholder="?"><label style="min-width:auto">multiplicity</label><input type="text" class="ps-s2-m2" placeholder="?" style="width:50px"></div>' +
            '      <button class="ps-btn ps-check-2">Check</button>' +
            '      <div class="ps-fb" id="ps-fb2-' + this._uid() + '"></div>' +
            '    </div>' +
            '  </div>' +

            // Step 3
            '  <div class="ps-step locked" id="ps-s3-' + this._uid() + '">' +
            '    <div class="ps-step-header"><span class="ps-badge">3</span> Determine crossing vs. touching behavior at each zero.</div>' +
            '    <div class="ps-step-body">' +
            '      <div class="ps-input-row"><label>At zero 1:</label>' +
            '        <select class="ps-s3-b1"><option value="">Select...</option><option value="cross">Crosses (odd mult.)</option><option value="touch">Touches (even mult.)</option></select></div>' +
            '      <div class="ps-input-row"><label>At zero 2:</label>' +
            '        <select class="ps-s3-b2"><option value="">Select...</option><option value="cross">Crosses (odd mult.)</option><option value="touch">Touches (even mult.)</option></select></div>' +
            '      <button class="ps-btn ps-check-3">Check</button>' +
            '      <div class="ps-fb" id="ps-fb3-' + this._uid() + '"></div>' +
            '    </div>' +
            '  </div>' +

            // Step 4
            '  <div class="ps-step locked" id="ps-s4-' + this._uid() + '">' +
            '    <div class="ps-step-header"><span class="ps-badge">4</span> Connect everything to sketch the full curve.</div>' +
            '    <div class="ps-step-body">' +
            '      <p>The full graph connects all features you identified.</p>' +
            '      <button class="ps-btn ps-reveal">Reveal Full Curve</button>' +
            '      <div class="ps-fb" id="ps-fb4-' + this._uid() + '"></div>' +
            '    </div>' +
            '  </div>' +

            '  <div class="ps-done" id="ps-done-' + this._uid() + '">&#10003; Complete!</div>' +
            '</div>'
        );
    };

    Question.prototype._uid = function () {
        if (!this._id) this._id = Math.random().toString(36).substr(2, 8);
        return this._id;
    };

    Question.prototype.setupGraph = function () {
        var q = this.question;
        var bb = q.boundingbox || [-4, 6.5, 4.5, -3];
        var boardId = 'ps-board-' + this._uid();

        // Load JSXGraph dynamically if not present
        var self = this;
        if (typeof JXG === 'undefined') {
            var link = document.createElement('link');
            link.rel = 'stylesheet';
            link.href = 'https://cdn.jsdelivr.net/npm/jsxgraph@1.9.2/distrib/jsxgraph.css';
            document.head.appendChild(link);

            var script = document.createElement('script');
            script.src = 'https://cdn.jsdelivr.net/npm/jsxgraph@1.9.2/distrib/jsxgraphcore.js';
            script.onload = function () { self._initBoard(boardId, bb); };
            document.head.appendChild(script);
        } else {
            this._initBoard(boardId, bb);
        }
    };

    Question.prototype._initBoard = function (boardId, bb) {
        var q = this.question;
        var zeros = q.valid_response.zeros;

        this.board = JXG.JSXGraph.initBoard(boardId, {
            boundingbox: bb, axis: true, grid: true,
            showNavigation: false, showCopyright: false
        });

        // Parse function from question config
        var coeffs = q.coefficients || [-2, 6, 0, -4.5]; // default: -2x^3 + 6x^2 + 0x - 4.5...
        var fn = q.fn_js || 'function(x){return -2*x*x*x+6*x*x-4.5*x;}';
        this._f = new Function('return ' + fn)();

        // End behavior arrows (hidden)
        var endLeft = q.valid_response.endBehavior.left === '+inf' ? 1 : -1;
        var endRight = q.valid_response.endBehavior.right === '+inf' ? 1 : -1;

        this.gfx = {};
        this.gfx.arrowLeft = this.board.create('curve', [
            function(t) { return -3.5 + t * 0.8; },
            function(t) { return (endLeft > 0 ? 4.5 : -1.5) + t * endLeft * 1.5; },
            0, 1
        ], { strokeColor: '#1565C0', strokeWidth: 2.5, visible: false, lastArrow: { type: 1, size: 6 } });

        this.gfx.arrowRight = this.board.create('curve', [
            function(t) { return 3 + t * 0.8; },
            function(t) { return (endRight > 0 ? -1.5 : -0.5) + t * endRight * -1.8; },
            0, 1
        ], { strokeColor: '#1565C0', strokeWidth: 2.5, visible: false, lastArrow: { type: 1, size: 6 } });

        this.gfx.lblLeft = this.board.create('text', [-3.2, endLeft > 0 ? 3.2 : -2, endLeft > 0 ? 'Up to left' : 'Down to left'], {
            fontSize: 12, color: '#1565C0', fontWeight: 'bold', visible: false
        });
        this.gfx.lblRight = this.board.create('text', [2.5, endRight > 0 ? -2 : 1, endRight > 0 ? 'Up to right' : 'Down to right'], {
            fontSize: 12, color: '#1565C0', fontWeight: 'bold', visible: false
        });

        // Zero points (hidden)
        this.gfx.zeroPts = [];
        this.gfx.zeroLbls = [];
        for (var i = 0; i < zeros.length; i++) {
            var z = zeros[i];
            var pt = this.board.create('point', [z.x, 0], {
                size: 5, color: '#e53935', fixed: true, visible: false, name: '', label: { visible: false }
            });
            var lbl = this.board.create('text', [z.x, 0.6, '(' + (z.xStr || z.x) + ', 0)'], {
                fontSize: 12, color: '#e53935', anchorX: 'middle', visible: false
            });
            this.gfx.zeroPts.push(pt);
            this.gfx.zeroLbls.push(lbl);
        }

        // Local behavior sketches (hidden)
        this.gfx.localCurves = [];
        this.gfx.localLabels = [];
        var f = this._f;
        for (var j = 0; j < zeros.length; j++) {
            var zz = zeros[j];
            var cx = zz.x;
            var beh = q.valid_response.behavior[j];
            var curve, label;

            if (beh === 'cross') {
                // Tangent line segment
                var slope = (f(cx + 0.01) - f(cx - 0.01)) / 0.02;
                if (Math.abs(slope) < 0.1) slope = -4; // fallback
                var s = slope;
                curve = this.board.create('curve', [
                    function(cx, s) { return function(t) { return cx + t; }; }(cx, s),
                    function(cx, s) { return function(t) { return s * t; }; }(cx, s),
                    -0.35, 0.35
                ], { strokeColor: '#7b1fa2', strokeWidth: 2.5, dash: 2, visible: false });
                label = this.board.create('text', [cx - 0.3, -1.2, 'crosses'], {
                    fontSize: 11, color: '#7b1fa2', fontStyle: 'italic', visible: false
                });
            } else {
                // Parabolic bounce
                curve = this.board.create('curve', [
                    function(cx) { return function(t) { return cx + t; }; }(cx),
                    function(cx) { return function(t) { return -2 * (2 * t) * (2 * t); }; }(cx),
                    -0.35, 0.35
                ], { strokeColor: '#7b1fa2', strokeWidth: 2.5, dash: 2, visible: false });
                label = this.board.create('text', [cx + 0.3, -1.2, 'touches'], {
                    fontSize: 11, color: '#7b1fa2', fontStyle: 'italic', visible: false
                });
            }
            this.gfx.localCurves.push(curve);
            this.gfx.localLabels.push(label);
        }

        // Full curve (hidden)
        this.gfx.fullCurve = this.board.create('functiongraph', [this._f], {
            strokeColor: '#2E7D32', strokeWidth: 3, visible: false
        });
    };

    Question.prototype.bindEvents = function () {
        var self = this;
        var vr = this.question.valid_response;

        this.$el.on('click', '.ps-check-1', function () {
            var left = self.$el.find('.ps-s1-left').val();
            var right = self.$el.find('.ps-s1-right').val();
            if (left === vr.endBehavior.left && right === vr.endBehavior.right) {
                self.showFb(1, true, 'Correct!');
                self.revealEndBehavior();
                self.response.endBehavior = { left: left, right: right };
                self.response.completedSteps = 1;
                self.emitChanged();
                setTimeout(function () { self.activateStep(2); }, 500);
            } else {
                self.showFb(1, false, 'Not quite. Think about the degree (odd/even) and sign of the leading coefficient.');
            }
        });

        this.$el.on('click', '.ps-check-2', function () {
            var z1 = self.$el.find('.ps-s2-z1').val().trim();
            var m1 = self.$el.find('.ps-s2-m1').val().trim();
            var z2 = self.$el.find('.ps-s2-z2').val().trim();
            var m2 = self.$el.find('.ps-s2-m2').val().trim();
            var z1ok = parseFloat(z1) === vr.zeros[0].x;
            var m1ok = parseInt(m1) === vr.zeros[0].mult;
            var z2ok = parseFloat(z2) === vr.zeros[1].x || z2 === vr.zeros[1].xStr;
            var m2ok = parseInt(m2) === vr.zeros[1].mult;
            if (z1ok && m1ok && z2ok && m2ok) {
                self.showFb(2, true, 'Correct!');
                self.revealZeros();
                self.response.zeros = [{ value: z1, multiplicity: m1 }, { value: z2, multiplicity: m2 }];
                self.response.completedSteps = 2;
                self.emitChanged();
                setTimeout(function () { self.activateStep(3); }, 500);
            } else {
                self.showFb(2, false, 'Check your zeros and multiplicities. Factor the polynomial completely.');
            }
        });

        this.$el.on('click', '.ps-check-3', function () {
            var b1 = self.$el.find('.ps-s3-b1').val();
            var b2 = self.$el.find('.ps-s3-b2').val();
            if (b1 === vr.behavior[0] && b2 === vr.behavior[1]) {
                self.showFb(3, true, 'Correct! Odd multiplicity \u2192 crosses; even multiplicity \u2192 touches.');
                self.revealLocalBehavior();
                self.response.behavior = [b1, b2];
                self.response.completedSteps = 3;
                self.emitChanged();
                setTimeout(function () { self.activateStep(4); }, 500);
            } else {
                self.showFb(3, false, 'Remember: odd multiplicity means the graph crosses; even means it touches and turns.');
            }
        });

        this.$el.on('click', '.ps-reveal', function () {
            self.revealFullCurve();
            self.showFb(4, true, 'The full curve connects all features!');
            self.response.completedSteps = 4;
            self.emitChanged();
            self.$el.find('#ps-s4-' + self._uid()).removeClass('active').addClass('completed');
            self.$el.find('#ps-done-' + self._uid()).show();
        });
    };

    Question.prototype.emitChanged = function () {
        this.events.trigger('changed', this.response);
    };

    Question.prototype.showFb = function (step, ok, msg) {
        var $fb = this.$el.find('#ps-fb' + step + '-' + this._uid());
        $fb.attr('class', 'ps-fb ' + (ok ? 'correct' : 'wrong')).text(msg).show();
    };

    Question.prototype.activateStep = function (n) {
        var uid = this._uid();
        for (var i = 1; i <= 4; i++) {
            var $s = this.$el.find('#ps-s' + i + '-' + uid);
            $s.removeClass('active locked completed');
            if (i < n) $s.addClass('completed');
            else if (i === n) $s.addClass('active');
            else $s.addClass('locked');
        }
        this.currentStep = n;
    };

    Question.prototype.revealEndBehavior = function () {
        this.gfx.arrowLeft.setAttribute({ visible: true });
        this.gfx.arrowRight.setAttribute({ visible: true });
        this.gfx.lblLeft.setAttribute({ visible: true });
        this.gfx.lblRight.setAttribute({ visible: true });
        this.board.update();
    };

    Question.prototype.revealZeros = function () {
        for (var i = 0; i < this.gfx.zeroPts.length; i++) {
            this.gfx.zeroPts[i].setAttribute({ visible: true });
            this.gfx.zeroLbls[i].setAttribute({ visible: true });
        }
        this.board.update();
    };

    Question.prototype.revealLocalBehavior = function () {
        for (var i = 0; i < this.gfx.localCurves.length; i++) {
            this.gfx.localCurves[i].setAttribute({ visible: true });
            this.gfx.localLabels[i].setAttribute({ visible: true });
        }
        this.board.update();
    };

    Question.prototype.revealFullCurve = function () {
        this.gfx.fullCurve.setAttribute({ visible: true });
        this.board.update();
    };

    Question.prototype.restoreState = function () {
        var steps = this.response.completedSteps || 0;
        if (steps >= 1) this.revealEndBehavior();
        if (steps >= 2) this.revealZeros();
        if (steps >= 3) this.revealLocalBehavior();
        if (steps >= 4) this.revealFullCurve();
        this.activateStep(Math.min(steps + 1, 5));
    };

    // Facade methods required by Learnosity
    Question.prototype.enable = function () { this.$el.find('select,input,button').prop('disabled', false); };
    Question.prototype.disable = function () { this.$el.find('select,input,button').prop('disabled', true); };
    Question.prototype.resetResponse = function () { this.response = {}; this.currentStep = 1; };

    return Question;
});
