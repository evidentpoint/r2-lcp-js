// ==LICENSE-BEGIN==
// Copyright 2017 European Digital Reading Lab. All rights reserved.
// Licensed to the Readium Foundation under one or more contributor license agreements.
// Use of this source code is governed by a BSD-style license
// that can be found in the LICENSE file exposed on Github (readium) in the project repository.
// ==LICENSE-END==

import { nodeStreamToBufferPromise } from "@utils/stream/BufferUtils";
import * as debug_ from "debug";
import * as request from "request";
import * as requestPromise from "request-promise-native";

import { IDeviceIDManager } from "./deviceid-manager";

import URI = require("urijs");
import URITemplate = require("urijs/src/URITemplate");

const debug = debug_("r2:lcp#lsd/renew");

export async function lsdRenew(
    end: Date | undefined,
    lsdJson: any,
    deviceIDManager: IDeviceIDManager): Promise<any> {

    if (!lsdJson.links) {
        return Promise.reject("No LSD links!");
    }

    const licenseRenew = lsdJson.links.find((link: any) => {
        return link.rel === "renew";
    });
    if (!licenseRenew) {
        return Promise.reject("No LSD renew link!");
    }

    let deviceID: string;
    try {
        deviceID = await deviceIDManager.getDeviceID();
    } catch (err) {
        debug(err);
        return Promise.reject("Problem getting Device ID !?");
    }

    let deviceNAME: string;
    try {
        deviceNAME = await deviceIDManager.getDeviceNAME();
    } catch (err) {
        debug(err);
        return Promise.reject("Problem getting Device NAME !?");
    }

    let renewURL = licenseRenew.href;
    if (licenseRenew.templated === true || licenseRenew.templated === "true") {
        const urlTemplate = new URITemplate(renewURL);
        renewURL = (urlTemplate as any).expand({ end: "xxx", id: deviceID, name: deviceNAME }, { strict: false });

        const renewURI = new URI(renewURL);
        renewURI.search((data: any) => {
            // overrides existing (leaves others intact)
            data.end = end; // can be undefined
        });
        renewURL = renewURI.toString();

        // url = url.replace("{?end,id,name}", ""); // TODO: smarter regexp?
        // url = new URI(url).setQuery("id", deviceID).setQuery("name", deviceNAME).toString();
    }
    debug("RENEW: " + renewURL);

    return new Promise<any>(async (resolve, reject) => {

        const failure = (err: any) => {
            reject(err);
        };

        const success = async (response: request.RequestResponse) => {

            Object.keys(response.headers).forEach((header: string) => {
                debug(header + " => " + response.headers[header]);
            });

            if (response.statusCode && (response.statusCode < 200 || response.statusCode >= 300)) {
                failure("HTTP CODE " + response.statusCode);
                return;
            }

            let responseData: Buffer;
            try {
                responseData = await nodeStreamToBufferPromise(response);
            } catch (err) {
                reject(err);
                return;
            }
            const responseStr = responseData.toString("utf8");
            debug(responseStr);
            const responseJson = global.JSON.parse(responseStr);
            debug(responseJson);

            resolve(responseJson);
        };

        const headers = {
            "Accept-Language": "en-UK,en-US;q=0.7,en;q=0.5",
        };

        // No response streaming! :(
        // https://github.com/request/request-promise/issues/90
        const needsStreamingResponse = true;
        if (needsStreamingResponse) {
            request.put({
                headers,
                method: "PUT",
                uri: renewURL,
            })
                .on("response", success)
                .on("error", failure);
        } else {
            let response: requestPromise.FullResponse;
            try {
                // tslint:disable-next-line:await-promise no-floating-promises
                response = await requestPromise({
                    headers,
                    method: "PUT",
                    resolveWithFullResponse: true,
                    uri: renewURL,
                });
            } catch (err) {
                failure(err);
                return;
            }

            await success(response);
        }
    });
}
