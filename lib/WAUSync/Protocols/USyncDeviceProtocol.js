import {
  assertNodeErrorFree,
  getBinaryNodeChild,
} from "../../WABinary/index.js";
export class USyncDeviceProtocol {
  constructor() {
    this.name = "devices";
  }
  getQueryElement() {
    return { tag: "devices", attrs: { version: "2" } };
  }
  getUserElement(user) {
    const attrs = {};
    if (user.phashing) {
      attrs.phashing = user.phashing;
    }
    if (user.ts) {
      attrs.ts = user.ts;
    }
    if (user.expectedTs) {
      attrs.expected_ts = user.expectedTs;
    }
    return Object.keys(attrs).length > 0 ? { tag: "devices", attrs: attrs } : null;
  }
  parser(node) {
    const deviceList = [];
    let keyIndex = undefined;
    if (node.tag === "devices") {
      assertNodeErrorFree(node);
      const deviceListNode = getBinaryNodeChild(node, "device-list");
      const keyIndexNode = getBinaryNodeChild(node, "key-index-list");
      if (Array.isArray(deviceListNode?.content)) {
        for (const { tag, attrs } of deviceListNode.content) {
          const id = +attrs.id;
          const keyIndex = +attrs["key-index"];
          if (tag === "device") {
            deviceList.push({
              id: id,
              keyIndex: keyIndex,
              isHosted: !!(attrs["is_hosted"] && attrs["is_hosted"] === "true"),
            });
          }
        }
      }
      if (keyIndexNode?.tag === "key-index-list") {
        keyIndex = {
          timestamp: +keyIndexNode.attrs["ts"],
          signedKeyIndex: keyIndexNode?.content,
          expectedTimestamp: keyIndexNode.attrs["expected_ts"]
            ? +keyIndexNode.attrs["expected_ts"]
            : undefined,
        };
      }
    }
    return { deviceList: deviceList, keyIndex: keyIndex };
  }
}
