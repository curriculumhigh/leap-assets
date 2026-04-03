/*
 * Learnosity Custom Question Scorer — Progressive Scaffold v3
 * Runs headless on Learnosity's servers (no DOM).
 *
 * Backward-compatible: handles both old format (scaffolds map) and
 * new v3 format (value string "completed/total" + inputs map).
 */
LearnosityAmd.define(function () {
    function Scorer(question, response) {
        this.question = question;
        this.response = response;
    }

    Scorer.prototype.isValid = function () {
        return this.response && this.response.value;
    };

    Scorer.prototype.score = function () {
        var resp = this.response;
        if (!resp) return 0;

        // v3 format: use value string "completed/total"
        var val = resp.value;
        if (val && typeof val === "string" && val.indexOf("/") >= 0) {
            var parts = val.split("/");
            var completed = parseInt(parts[0]) || 0;
            var total = parseInt(parts[1]) || 1;
            if (completed >= total) return this.maxScore();
            return Math.round((completed / total) * this.maxScore());
        }

        // Fallback: v1 format — count correct inputs from scaffolds map
        if (!resp.scaffolds) return 0;

        var scaffolds = this.question.scaffolds || [];
        var earned = 0;

        for (var i = 0; i < scaffolds.length; i++) {
            var sc = scaffolds[i];
            var scaffoldResp = resp.scaffolds[String(i)];
            if (!scaffoldResp) continue;

            var steps = sc.steps || [];
            for (var j = 0; j < steps.length; j++) {
                var inputs = steps[j].inputs;
                if (!inputs) continue;
                for (var k = 0; k < inputs.length; k++) {
                    var key = "s" + j + "_" + k;
                    var userVal = scaffoldResp[key];
                    if (!userVal) continue;

                    var answers = String(inputs[k].answer).split("|");
                    for (var a = 0; a < answers.length; a++) {
                        var expected = answers[a].replace(/\s+/g, '').toLowerCase();
                        var normUser = String(userVal).replace(/\s+/g, '').toLowerCase();
                        if (normUser === expected) {
                            earned++;
                            break;
                        }
                        var numUser = parseFloat(userVal);
                        var numExpected = parseFloat(answers[a]);
                        if (!isNaN(numUser) && !isNaN(numExpected) && Math.abs(numUser - numExpected) < 0.001) {
                            earned++;
                            break;
                        }
                    }
                }
            }
        }

        return earned;
    };

    Scorer.prototype.maxScore = function () {
        if (this.question.score) return this.question.score;

        // Count total inputs across all scaffolds
        var scaffolds = this.question.scaffolds || [];
        var total = 0;
        for (var i = 0; i < scaffolds.length; i++) {
            var steps = scaffolds[i].steps || [];
            for (var j = 0; j < steps.length; j++) {
                if (steps[j].inputs) total += steps[j].inputs.length;
            }
        }
        return total;
    };

    Scorer.prototype.canValidateResponse = function () {
        return true;
    };

    Scorer.prototype.validateIndividualResponses = function () {
        if (!this.response || !this.response.scaffolds) return {};

        var result = {};
        var scaffolds = this.question.scaffolds || [];

        for (var i = 0; i < scaffolds.length; i++) {
            var sc = scaffolds[i];
            var resp = this.response.scaffolds[String(i)];
            var steps = sc.steps || [];

            for (var j = 0; j < steps.length; j++) {
                var inputs = steps[j].inputs;
                if (!inputs) continue;
                for (var k = 0; k < inputs.length; k++) {
                    var key = "scaffold" + i + "_s" + j + "_" + k;
                    if (!resp || !resp["s" + j + "_" + k]) {
                        result[key] = false;
                        continue;
                    }
                    var userVal = resp["s" + j + "_" + k];
                    var answers = String(inputs[k].answer).split("|");
                    var correct = false;
                    for (var a = 0; a < answers.length; a++) {
                        var expected = answers[a].replace(/\s+/g, '').toLowerCase();
                        var normUser = String(userVal).replace(/\s+/g, '').toLowerCase();
                        if (normUser === expected) { correct = true; break; }
                        var numUser = parseFloat(userVal);
                        var numExpected = parseFloat(answers[a]);
                        if (!isNaN(numUser) && !isNaN(numExpected) && Math.abs(numUser - numExpected) < 0.001) { correct = true; break; }
                    }
                    result[key] = correct;
                }
            }
        }

        return result;
    };

    return Scorer;
});
