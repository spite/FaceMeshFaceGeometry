# FaceMeshFaceGeometry

Three.js helper for the MediaPipe face mesh: turns the 468 face landmarks from [MediaPipe's Face Landmarker](https://ai.google.dev/edge/mediapipe/solutions/vision/face_landmarker) into a `BufferGeometry`, with texture coordinates, normals and tracking helpers.

---

Demo with textured mask: https://spite.github.io/FaceMeshFaceGeometry/examples/mask/index.html

Demo with remapped video: https://spite.github.io/FaceMeshFaceGeometry/examples/video/index.html

Demo with instanced geometry: https://spite.github.io/FaceMeshFaceGeometry/examples/instanced/index.html

Demo of texture mapping from an image: https://spite.github.io/FaceMeshFaceGeometry/examples/face_transfer/index.html

Demo of face switching: https://spite.github.io/FaceMeshFaceGeometry/examples/face_off/index.html

![FaceMeshFaceGeometry](uvmap.png)

## How to use

The helper works with [MediaPipe's Face Landmarker](https://ai.google.dev/edge/mediapipe/solutions/vision/face_landmarker/web_js) (what the examples use), and with faces from [@tensorflow-models/face-landmarks-detection](https://github.com/tensorflow/tfjs-models/tree/master/face-landmarks-detection). The original `@tensorflow-models/facemesh` package is deprecated and no longer supported.

`face.js` imports `three` as a bare module specifier, so use a bundler or an import map:

```html
<script type="importmap">
  { "imports": { "three": "https://cdn.jsdelivr.net/npm/three@0.186.1/build/three.module.js" } }
</script>
```

First import the class.

`import { FaceMeshFaceGeometry } from './face.js';`

Create a new geometry helper.

`const faceGeometry = new FaceMeshFaceGeometry();`

Create a Face Landmarker:

```js
import { FaceLandmarker, FilesetResolver } from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.1.0/vision_bundle.mjs";

const fileset = await FilesetResolver.forVisionTasks("https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.1.0/wasm");
const landmarker = await FaceLandmarker.createFromOptions(fileset, {
  baseOptions: {
    modelAssetPath: "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task",
    delegate: "GPU",
  },
  runningMode: "VIDEO",
  numFaces: 1,
});
```

On the update loop, after the model returns some faces:

```js
faceGeometry.setSize(video.videoWidth, video.videoHeight);
const faces = landmarker.detectForVideo(video, performance.now()).faceLandmarks;
if (faces.length) {
  faceGeometry.update(faces[0]);
}
```

You have to call `FaceMeshFaceGeometry::setSize` with the width and height of the video to normalise the coordinates so they align with the video source.

That's all there is. You can use `faceGeometry` as any other `BufferGeometry`:

```js
const material = new MeshNormalMaterial();
const mask = new Mesh(faceGeometry, material);
scene.add(mask);
```

## Running the examples

The examples need to be served over HTTP, and the camera is only available on `localhost` or HTTPS. From the root of the repo:

```
npx serve .
```

and open, for instance, http://localhost:3000/examples/mask/.

## Mirrored video

This works for the video as it comes. If your source is a webcam, you might want to flip it horizontally.

In that case -besides flipping the video element, by using `transform: scaleX(-1)`, for instance- pass `true` as the second argument of `update`. Pass the landmarks as the model returns them; the helper mirrors the mesh itself:

```js
faceGeometry.update(faces[0], true);
```

## How to use the video/input as a texture for the face

You can use the input to the model to texture the 3d mesh of the face. Construct the helper with:

`const faceGeometry = new FaceMeshFaceGeometry({useVideoTexture: true});`

That will remap the UV coordinates of the geometry to fit the input. The vertex coordinates from the estimation will be projected every frame into the UV space. That means that the UV coordinates for the shader won't work for texture mapping (i.e., alpha mask, ao map, etc. will be mapped differently and probably wrong).

There seem to be issues with instanced video in macOS Chrome and Safari.

## How to use as a 3d mesh, independently of the camera

The range of the vertices is based on the resolution of the input feed, so it changes depending on the chosen video or image input. Construct the FaceGeometry helper with the option normalizeCoords set to true and the mesh will be centered and scaled so the height of the input is 1 unit.

`const faceGeometry = new FaceMeshFaceGeometry({normalizeCoords: true});`

## How to update my threejs camera

Face mesh data works better with an Orthographic camera. First create a camera:

`const camera = new OrthographicCamera(1, 1, 1, 1, -1000, 1000);`

and then when the video is ready, or the video dimensions change (width, height), run:

```js
camera.left = -.5 * width;
camera.right = .5 * width;
camera.top = .5 * height;
camera.bottom = -.5 * height;
camera.updateProjectionMatrix();
```

## Track points in geometry

After `faceGeometry.update()` you can use `faceGeometry.track()` to place objects relative to the surface of the face.

```js
const track = faceGeometry.track(5, 45, 275);
dummy.position.copy(track.position);
dummy.rotation.setFromRotationMatrix(track.rotation);
```

It will calculate a triangle defined by the three provided vertex ids, and return a `position`, a `normal`, and an orthogonal basis `rotation` that can be used to rotate an object along the correct normal of that triangle.

Use [this image](https://user-images.githubusercontent.com/7452527/53465316-4a282000-3a02-11e9-8e85-0006e3100da0.png) as a reference for vertex Ids.

## API

`FaceMeshFaceGeometry::update(face: NormalizedLandmark[] | Face, flipped = false): void`

Updates the vertices and recalculates normals. `face` is either one entry of `faceLandmarks` from MediaPipe's Face Landmarker, or a face with `keypoints` from face-landmarks-detection.

`FaceMeshFaceGeometry::setSize(width: number, height: number): void`

Sets the internal values to reframe the coordinates.

`FaceMeshFaceGeometry::track(id0: number, id1: number, id2: number): { position: Vector3, normal: Vector3, rotation: Matrix4 }`

Calculates a triangle defined by vertices id0, id1 and id2, returns its center, normal and orthogonal basis.
