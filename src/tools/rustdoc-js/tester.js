// Copyright 2018 The Rust Project Developers. See the COPYRIGHT
// file at the top-level directory of this distribution and at
// http://rust-lang.org/COPYRIGHT.
//
// Licensed under the Apache License, Version 2.0 <LICENSE-APACHE or
// http://www.apache.org/licenses/LICENSE-2.0> or the MIT license
// <LICENSE-MIT or http://opensource.org/licenses/MIT>, at your
// option. This file may not be copied, modified, or distributed
// except according to those terms.

const fs = require('fs');

const TEST_FOLDER = 'src/test/rustdoc-js/';

function getNextStep(content, pos, stop) {
    while (pos < content.length && content[pos] !== stop &&
           (content[pos] === ' ' || content[pos] === '\t' || content[pos] === '\n')) {
        pos += 1;
    }
    if (pos >= content.length) {
        return null;
    }
    if (content[pos] !== stop) {
        return pos * -1;
    }
    return pos;
}

// Stupid function extractor based on indent.
function extractFunction(content, functionName) {
    var indent = 0;
    var splitter = "function " + functionName + "(";

    while (true) {
        var start = content.indexOf(splitter);
        if (start === -1) {
            break;
        }
        var pos = start;
        while (pos < content.length && content[pos] !== ')') {
            pos += 1;
        }
        if (pos >= content.length) {
            break;
        }
        pos = getNextStep(content, pos + 1, '{');
        if (pos === null) {
            break;
        } else if (pos < 0) {
            content = content.slice(-pos);
            continue;
        }
        while (pos < content.length) {
            if (content[pos] === '"' || content[pos] === "'") {
                var stop = content[pos];
                var is_escaped = false;
                do {
                    if (content[pos] === '\\') {
                        pos += 2;
                    } else {
                        pos += 1;
                    }
                } while (pos < content.length &&
                         (content[pos] !== stop || content[pos - 1] === '\\'));
            } else if (content[pos] === '{') {
                indent += 1;
            } else if (content[pos] === '}') {
                indent -= 1;
                if (indent === 0) {
                    return content.slice(start, pos + 1);
                }
            }
            pos += 1;
        }
        content = content.slice(start + 1);
    }
    return null;
}

// Stupid function extractor for array.
function extractArrayVariable(content, arrayName) {
    var splitter = "var " + arrayName;
    while (true) {
        var start = content.indexOf(splitter);
        if (start === -1) {
            break;
        }
        var pos = getNextStep(content, start, '=');
        if (pos === null) {
            break;
        } else if (pos < 0) {
            content = content.slice(-pos);
            continue;
        }
        pos = getNextStep(content, pos, '[');
        if (pos === null) {
            break;
        } else if (pos < 0) {
            content = content.slice(-pos);
            continue;
        }
        while (pos < content.length) {
            if (content[pos] === '"' || content[pos] === "'") {
                var stop = content[pos];
                do {
                    if (content[pos] === '\\') {
                        pos += 2;
                    } else {
                        pos += 1;
                    }
                } while (pos < content.length &&
                         (content[pos] !== stop || content[pos - 1] === '\\'));
            } else if (content[pos] === ']' &&
                       pos + 1 < content.length &&
                       content[pos + 1] === ';') {
                return content.slice(start, pos + 2);
            }
            pos += 1;
        }
        content = content.slice(start + 1);
    }
    return null;
}

// Stupid function extractor for variable.
function extractVariable(content, varName) {
    var splitter = "var " + varName;
    while (true) {
        var start = content.indexOf(splitter);
        if (start === -1) {
            break;
        }
        var pos = getNextStep(content, start, '=');
        if (pos === null) {
            break;
        } else if (pos < 0) {
            content = content.slice(-pos);
            continue;
        }
        while (pos < content.length) {
            if (content[pos] === '"' || content[pos] === "'") {
                var stop = content[pos];
                do {
                    if (content[pos] === '\\') {
                        pos += 2;
                    } else {
                        pos += 1;
                    }
                } while (pos < content.length &&
                         (content[pos] !== stop || content[pos - 1] === '\\'));
            } else if (content[pos] === ';') {
                return content.slice(start, pos + 1);
            }
            pos += 1;
        }
        content = content.slice(start + 1);
    }
    return null;
}

function loadContent(content) {
    var Module = module.constructor;
    var m = new Module();
    m._compile(content, "tmp.js");
    m.exports.ignore_order = content.indexOf("\n// ignore-order\n") !== -1;
    m.exports.exact_check = content.indexOf("\n// exact-check\n") !== -1;
    m.exports.should_fail = content.indexOf("\n// should-fail\n") !== -1;
    return m.exports;
}

function readFile(filePath) {
    return fs.readFileSync(filePath, 'utf8');
}

function loadThings(thingsToLoad, kindOfLoad, funcToCall, fileContent) {
    var content = '';
    for (var i = 0; i < thingsToLoad.length; ++i) {
        var tmp = funcToCall(fileContent, thingsToLoad[i]);
        if (tmp === null) {
            console.error('unable to find ' + kindOfLoad + ' "' + thingsToLoad[i] + '"');
            process.exit(1);
        }
        content += tmp;
        content += 'exports.' + thingsToLoad[i] + ' = ' + thingsToLoad[i] + ';';
    }
    return content;
}

function lookForEntry(entry, data) {
    for (var i = 0; i < data.length; ++i) {
        var allGood = true;
        for (var key in entry) {
            if (!entry.hasOwnProperty(key)) {
                continue;
            }
            var value = data[i][key];
            // To make our life easier, if there is a "parent" type, we add it to the path.
            if (key === 'path' && data[i]['parent'] !== undefined) {
                if (value.length > 0) {
                    value += '::' + data[i]['parent']['name'];
                } else {
                    value = data[i]['parent']['name'];
                }
            }
            if (value !== entry[key]) {
                allGood = false;
                break;
            }
        }
        if (allGood === true) {
            return i;
        }
    }
    return null;
}

function main(argv) {
    if (argv.length !== 3) {
        console.error("Expected toolchain to check as argument (for example 'x86_64-apple-darwin'");
        return 1;
    }
    var toolchain = argv[2];

    var mainJs = readFile("build/" + toolchain + "/doc/main.js");
    var ALIASES = readFile("build/" + toolchain + "/doc/aliases.js");
    var searchIndex = readFile("build/" + toolchain + "/doc/search-index.js").split("\n");
    if (searchIndex[searchIndex.length - 1].length === 0) {
        searchIndex.pop();
    }
    searchIndex.pop();
    searchIndex = loadContent(searchIndex.join("\n") + '\nexports.searchIndex = searchIndex;');
    finalJS = "";

    var arraysToLoad = ["itemTypes"];
    var variablesToLoad = ["MAX_LEV_DISTANCE", "MAX_RESULTS",
                           "TY_PRIMITIVE", "TY_KEYWORD",
                           "levenshtein_row2"];
    // execQuery first parameter is built in getQuery (which takes in the search input).
    // execQuery last parameter is built in buildIndex.
    // buildIndex requires the hashmap from search-index.
    var functionsToLoad = ["buildHrefAndPath", "pathSplitter", "levenshtein", "validateResult",
                           "getQuery", "buildIndex", "execQuery", "execSearch"];

    finalJS += 'window = { "currentCrate": "std" };\n';
    finalJS += 'var rootPath = "../";\n';
    finalJS += ALIASES;
    finalJS += loadThings(arraysToLoad, 'array', extractArrayVariable, mainJs);
    finalJS += loadThings(variablesToLoad, 'variable', extractVariable, mainJs);
    finalJS += loadThings(functionsToLoad, 'function', extractFunction, mainJs);

    var loaded = loadContent(finalJS);
    var index = loaded.buildIndex(searchIndex.searchIndex);

    var errors = 0;

    fs.readdirSync(TEST_FOLDER).forEach(function(file) {
        var loadedFile = loadContent(readFile(TEST_FOLDER + file) +
                               'exports.QUERY = QUERY;exports.EXPECTED = EXPECTED;');
        const expected = loadedFile.EXPECTED;
        const query = loadedFile.QUERY;
        const ignore_order = loadedFile.ignore_order;
        const exact_check = loadedFile.exact_check;
        const should_fail = loadedFile.should_fail;
        var results = loaded.execSearch(loaded.getQuery(query), index);
        process.stdout.write('Checking "' + file + '" ... ');
        var error_text = [];
        for (var key in expected) {
            if (!expected.hasOwnProperty(key)) {
                continue;
            }
            if (!results.hasOwnProperty(key)) {
                error_text.push('==> Unknown key "' + key + '"');
                break;
            }
            var entry = expected[key];
            var prev_pos = -1;
            for (var i = 0; i < entry.length; ++i) {
                var entry_pos = lookForEntry(entry[i], results[key]);
                if (entry_pos === null) {
                    error_text.push("==> Result not found in '" + key + "': '" +
                                    JSON.stringify(entry[i]) + "'");
                } else if (exact_check === true && prev_pos + 1 !== entry_pos) {
                    error_text.push("==> Exact check failed at position " + (prev_pos + 1) + ": " +
                                    "expected '" + JSON.stringify(entry[i]) + "' but found '" +
                                    JSON.stringify(results[key][i]) + "'");
                } else if (ignore_order === false && entry_pos < prev_pos) {
                    error_text.push("==> '" + JSON.stringify(entry[i]) + "' was supposed to be " +
                                    " before '" + JSON.stringify(results[key][entry_pos]) + "'");
                } else {
                    prev_pos = entry_pos;
                }
            }
        }
        if (error_text.length === 0 && should_fail === true) {
            errors += 1;
            console.error("FAILED");
            console.error("==> Test was supposed to fail but all items were found...");
        } else if (error_text.length !== 0 && should_fail === false) {
            errors += 1;
            console.error("FAILED");
            console.error(error_text.join("\n"));
        } else {
            console.log("OK");
        }
    });
    return errors;
}

process.exit(main(process.argv));
