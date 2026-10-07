import {
  Group,
  Mesh,
  MeshStandardMaterial,
  TorusGeometry,
  CircleGeometry,
  CylinderGeometry,
  IcosahedronGeometry,
  Vector3,
  DoubleSide,
} from "three";
import { CANONICAL } from "../js/geometry.js";

// Things to wear, built in the canonical face space (centimeters), to follow faceGeometry.pose.

function canonicalCenter(ids) {
  const v = new Vector3();
  for (const id of ids) {
    v.x += CANONICAL[id][0] / ids.length;
    v.y += CANONICAL[id][1] / ids.length;
    v.z += CANONICAL[id][2] / ids.length;
  }
  return v;
}

// A pair of round glasses around the eyes, with temples running back past the ears.
function createGlasses() {
  const frameMaterial = new MeshStandardMaterial({
    color: 0x222222,
    roughness: 0.3,
    metalness: 0.6,
  });
  const lensMaterial = new MeshStandardMaterial({
    color: 0x203040,
    roughness: 0.05,
    metalness: 0.2,
    transparent: true,
    opacity: 0.6,
    side: DoubleSide,
  });

  const glasses = new Group();
  const rightEye = canonicalCenter([33, 133, 159, 145]);
  const leftEye = canonicalCenter([263, 362, 386, 374]);
  const bridge = canonicalCenter([168]);
  const lensRadius = 2.5;
  const lensZ = bridge.z + 0.6;

  for (const eye of [rightEye, leftEye]) {
    const rim = new Mesh(new TorusGeometry(lensRadius, 0.18, 12, 48), frameMaterial);
    rim.position.set(eye.x, eye.y, lensZ);
    rim.scale.y = 0.8;
    glasses.add(rim);

    const lens = new Mesh(new CircleGeometry(lensRadius, 48), lensMaterial);
    lens.position.copy(rim.position);
    lens.scale.y = 0.8;
    glasses.add(lens);

    const side = Math.sign(eye.x);
    const hinge = new Vector3(eye.x + side * lensRadius, eye.y + 0.5, lensZ);
    const end = new Vector3(side * 7.6, eye.y, -7);
    const temple = new Mesh(
      new CylinderGeometry(0.15, 0.15, hinge.distanceTo(end), 8).rotateX(Math.PI / 2),
      frameMaterial
    );
    temple.position.copy(hinge).add(end).multiplyScalar(0.5);
    temple.lookAt(end);
    glasses.add(temple);
  }

  const bridgeArc = new Mesh(
    new TorusGeometry(leftEye.x - lensRadius, 0.15, 8, 24, Math.PI),
    frameMaterial
  );
  bridgeArc.position.set(0, rightEye.y, lensZ);
  glasses.add(bridgeArc);

  glasses.traverse((child) => (child.castShadow = true));
  return glasses;
}

// A red clown nose, half sunk into the tip of the nose.
function createClownNose() {
  const nose = new Mesh(
    new IcosahedronGeometry(2, 3),
    new MeshStandardMaterial({ color: 0xff6347, roughness: 0.4, metalness: 0.1 })
  );
  nose.position.copy(canonicalCenter([1])).add(new Vector3(0, 0, 0.8));
  nose.castShadow = true;
  return nose;
}

export { createGlasses, createClownNose };
