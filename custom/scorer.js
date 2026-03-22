/*
 * Learnosity Custom Question Scorer — Polynomial Sketch Activity
 * Runs headless on Learnosity's servers (no DOM).
 */
LearnosityAmd.define(function () {
    function Scorer(question, response) {
        this.question = question;
        this.response = response;
    }

    Scorer.prototype.isValid = function () {
        return this.score() === this.maxScore();
    };

    Scorer.prototype.score = function () {
        if (!this.response) return 0;
        var vr = this.question.valid_response;
        var r = this.response;
        var earned = 0;

        // End behavior (2 points)
        if (r.endBehavior) {
            if (r.endBehavior.left === vr.endBehavior.left) earned++;
            if (r.endBehavior.right === vr.endBehavior.right) earned++;
        }

        // Zeros and multiplicities (4 points)
        if (r.zeros && vr.zeros) {
            for (var i = 0; i < vr.zeros.length; i++) {
                var vz = vr.zeros[i];
                var rz = r.zeros[i];
                if (rz) {
                    if (parseFloat(rz.value) === vz.x || rz.value === vz.xStr) earned++;
                    if (parseInt(rz.multiplicity) === vz.mult) earned++;
                }
            }
        }

        // Crossing/touching behavior (2 points)
        if (r.behavior && vr.behavior) {
            for (var j = 0; j < vr.behavior.length; j++) {
                if (r.behavior[j] === vr.behavior[j]) earned++;
            }
        }

        return earned;
    };

    Scorer.prototype.maxScore = function () {
        return this.question.score || 8;
    };

    Scorer.prototype.canValidateResponse = function () {
        return true;
    };

    Scorer.prototype.validateIndividualResponses = function () {
        if (!this.response) return {};
        var vr = this.question.valid_response;
        var r = this.response;
        return {
            endBehaviorLeft: r.endBehavior && r.endBehavior.left === vr.endBehavior.left,
            endBehaviorRight: r.endBehavior && r.endBehavior.right === vr.endBehavior.right,
            zero1Value: r.zeros && r.zeros[0] && (parseFloat(r.zeros[0].value) === vr.zeros[0].x),
            zero1Mult: r.zeros && r.zeros[0] && (parseInt(r.zeros[0].multiplicity) === vr.zeros[0].mult),
            zero2Value: r.zeros && r.zeros[1] && (parseFloat(r.zeros[1].value) === vr.zeros[1].x || r.zeros[1].value === vr.zeros[1].xStr),
            zero2Mult: r.zeros && r.zeros[1] && (parseInt(r.zeros[1].multiplicity) === vr.zeros[1].mult),
            behavior1: r.behavior && r.behavior[0] === vr.behavior[0],
            behavior2: r.behavior && r.behavior[1] === vr.behavior[1],
        };
    };

    return Scorer;
});
