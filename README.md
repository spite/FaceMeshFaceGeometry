# FaceMeshFaceGeometry

Three.js helper for FaceMesh https://github.com/tensorflow/tfjs-models/tree/master/facemesh

## How to use

After following the code in the FaceMesh repo, you end up with a face estimation.

First import the class.

```import { FaceMeshFaceGeometry } from './face.js';```

Create a new geometry helper.

```const faceGeometry = new FaceMeshFaceGeometry();```

On the update loop, after the model returns some faces:

```faceGeometry.setSize(videoWidth, videoHeight);
const faces = await model.estimateFaces(video);
if(faces.length) {
  faceGeometry.update(faces[0]);
}
```
You have to call FaceMeshFaceGeometry::setSize with the width and height of the video to normalise the coordinates so they align with the video source.

That's all there is. You can use ```faceGeometry.geometry``` as any other ```BufferGeometry```:

```const material = new MeshNormalMaterial();
const mask = new Mesh(faceGeometry.geometry, material);
scene.add(mask);
```

## Mirrored video

This works for the video as it comes. If your source is a webcam, you might want to flip it horizontally.

In that case -besides flipping the video element, by using ```transform: scaleX(-1)```, for instance- you'll have to pass a flag to ```estimateFaces``` and ```update```:

```faceGeometry.setSize(videoWidth, videoHeight);
const faces = await model.estimateFaces(video, false, true);
if(faces.length) {
  faceGeometry.update(faces[0], true);
}
```

## How to update my threejs camera

FaceMesh data works better with an Orthographic camera. First create a camera:

```const camera = new OrthographicCamera(1, 1, 1, 1, -1000, 1000);```

and then when the video is ready, or the video dimensions change (width, height), run:

```
camera.left = -.5 * width;
camera.right = .5 * width;
camera.top = .5 * height;
camera.bottom = -.5 * height;
camera.updateProjectionMatrix();
```
    
