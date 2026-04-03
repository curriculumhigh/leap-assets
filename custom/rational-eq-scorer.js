/**
 * Rational Equation — Learnosity Custom Scorer (server-side)
 *
 * Custom type: "rational_equation"
 * Response format: { value: "completed/total" }
 */
LearnosityAmd.define([], function () {
    "use strict";

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
        return Math.round((completed / total) * this.maxScore());
    };

    Scorer.prototype.maxScore = function () {
        return this.question.score || 1;
    };

    return { Scorer: Scorer };
});
