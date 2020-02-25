// ----------------------------------------------------------------------------
// Copyright (c) Microsoft Corporation.  All rights reserved.
// ----------------------------------------------------------------------------

import * as assert from "assert";
import { mayBeMatchingParamFile } from "../extension.bundle";

suite("ParameterFiles", () => {
    suite("mayBeMatchingParamFile", () => {
        function isLikely(expected: boolean, templateFileName: string, possibleParamFileName: string): void {
            test(`(${templateFileName}, ${possibleParamFileName})`, () => {
                const result = mayBeMatchingParamFile(templateFileName, possibleParamFileName);
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
