/**
 * Rational Equation — Learnosity Custom Scorer v3 (server-side)
 *
 * Custom type: "rational_equation"
 * Response format: { value: "completed/total", inputs: {...}, ... }
 *
 * Backward-compatible: value is always the "N/M" progress string.
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
        var val = this.response ? this.response.value : null;
        if (!val) return 0;
        // Safety fallback: if value is somehow an object, extract progress
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

    return { Scorer: Scorer };
});
