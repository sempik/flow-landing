// Заглушка headphones.js: вращающийся тор вместо наушников, тот же контракт.
import * as THREE from 'three';

function createHeadphonesScene(canvas) {
  const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(35, 1, 0.1, 100);
  camera.position.set(0, 0, 8);
  scene.add(new THREE.HemisphereLight(0xffc08a, 0x221008, 1.2));
  const rim = new THREE.DirectionalLight(0x45e6ff, 3); rim.position.set(-3, 2, -4); scene.add(rim);
  const mesh = new THREE.Mesh(new THREE.TorusGeometry(1.2, 0.35, 32, 96), new THREE.MeshStandardMaterial({ color: 0x1c1d22, metalness: 0.6, roughness: 0.35 }));
  scene.add(mesh);
  let progress = 0;
  function resize() {
    const w = canvas.clientWidth || innerWidth, h = canvas.clientHeight || innerHeight;
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    renderer.setSize(w, h, false);
    camera.aspect = w / h; camera.updateProjectionMatrix();
  }
  function frame() {
    mesh.rotation.y = progress * Math.PI * 4;
    mesh.position.x = 1.5;
    renderer.render(scene, camera);
    requestAnimationFrame(frame);
  }
  resize(); frame();
  return {
    setProgress(p) { progress = p; },
    resize,
    setPointer() {},
    getAnchor() {
      const v = mesh.position.clone().project(camera);
      return { x: (v.x + 1) / 2 * canvas.clientWidth, y: (1 - v.y) / 2 * canvas.clientHeight, visible: true };
    },
    setFinaleTarget() {},
    dispose() { renderer.dispose(); },
  };
}
