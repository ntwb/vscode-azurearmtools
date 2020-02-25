// ----------------------------------------------------------------------------
// Copyright (c) Microsoft Corporation.  All rights reserved.
// ----------------------------------------------------------------------------

import * as assert from "assert";
import { isLikelyMatchingParamsFileBasedOnName } from "../extension.bundle";

suite("ParametersFiles", () => {
    suite("isLikelyMatchingParamsFileBasedOnName", () => {
        function isLikely(expected: boolean, templateFileName: string, possibleParamsFileName: string): void {
            test(`(${templateFileName}, ${possibleParamsFileName})`, () => {
                const result = isLikelyMatchingParamsFileBasedOnName(templateFileName, possibleParamsFileName);
                assert.equal(result, expected);
            });
        }

        isLikely(true, "template.json", "template.params.json");
        isLikely(true, "template.json", "template.parameters.json");

        isLikely(true, "template.json", "template.params.dev.json");
        isLikely(true, "template.json", "template.parameters.dev.json");

        isLikely(true, "template.json", "template.params.dev.whatever.json");
        isLikely(true, "template.json", "template.parameters.dev.json");

        isLikely(true, "TEMPlate.json", "template.params.dev.whatever.JSON");
        isLikely(true, "template.JSON", "Template.PARAMETERS.deV.Json");

        isLikely(true, "TEMPlate.json", "template.params.dev.whatever.JSONc");
        isLikely(true, "template.JSON", "Template.PARAMETERS.deV.JsonC");
    });
});
