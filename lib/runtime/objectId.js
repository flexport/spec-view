/**
 * TEAM: backend_infra
 * WATCHERS: osuushi
 * @noflow (this is injected through selenium, and does not go through the build pipeline)
 */
/* eslint-disable flowtype/require-parameter-type */
/* global _SpecView */

const objectIdMap = new WeakMap();

const nextObjectId = (() => {
  let nextId = 0;
  return () => {
    nextId += 1;
    return `@${nextId}`;
  };
})();

// Provides a string representation of object identity so that we can construct
// meaningful hashes for use in sets.
_SpecView.objectId = obj => {
  if (obj == null) return "@null"; // null and undefined are considered equivalent
  if (typeof obj !== "object")
    throw new Error("objectId can only be used with objects or null/undefined");

  // JS does not directly expose object addresses or any other form of unique
  // id for objects, but a map allows us to create a bijection with them
  // anyway. We simply assign a sequential id whenever we see a new object,
  // and return that id every time we see that object from that point forward.
  if (objectIdMap.has(obj)) return objectIdMap.get(obj);
  const id = nextObjectId();
  objectIdMap.set(obj, id);
  return id;
};
