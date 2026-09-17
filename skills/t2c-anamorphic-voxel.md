## 핵심 정체

흔히 말하는 "파티클(입자가 흩날리는)" 효과가 아니라, Three.js로 만든 **3D 복셀(voxel) 조형물**이다. 텍스트와 로고 이미지를 작은 정육면체 수천 개로 재구성해서, 정면에서 보면 로고 모양으로, 옆에서 보면 텍스트 모양으로 읽히는 아나모픽(anamorphic) 입체를 만든다.

## 원리 1 — 두 방향에서 본 실루엣을 합쳐서 입체를 만든다

1. 화면에 보이지 않는 2D `canvas`를 하나 만들고, 거기에 텍스트("text to / context")를 그린다. 또 다른 숨겨진 canvas에는 로고 이미지를 그린다.
2. `ctx.getImageData()`로 픽셀을 한 줄씩 훑으면서, 알파값이 높고 어두운 색(검은 글자·로고 부분)인 픽셀의 좌표만 뽑아낸다. `extractPixels()` 함수가 하는 일이다.
3. 텍스트에서 뽑은 좌표는 "옆에서 본 모양(side, z축용)"으로 쓰고, 로고에서 뽑은 좌표는 "정면에서 본 모양(front, x축용)"으로 쓴다.
4. 같은 y줄(row)끼리 두 좌표 세트를 짝지어서 하나의 점을 만든다. `x`는 로고 실루엣에서, `z`는 텍스트 실루엣에서, `y`는 공통 줄 번호에서 가져온다. 이렇게 하면 정면에서 보면 로고 모양, 옆에서 보면 텍스트 모양으로 읽히는 입체가 만들어진다. 극장 간판이나 계단 아나모픽 아트와 같은 트릭이다.

## 원리 2 — 개별 메쉬 대신 InstancedMesh 사용

점 하나하나에 큐브를 따로 만들면 수천 개 오브젝트 때문에 느려지므로, `THREE.InstancedMesh`로 같은 지오메트리를 재사용하면서 위치만 다르게 배치한다.

```javascript
const geometry = new THREE.BoxGeometry(CUBE_SIZE, CUBE_SIZE, CUBE_SIZE).toNonIndexed();
const mesh = new THREE.InstancedMesh(geometry, material, particlesData.length);
const dummy = new THREE.Object3D();

particlesData.forEach((p, i) => {
  dummy.position.set(p.x, p.y, p.z);
  dummy.rotation.set(Math.random() * 0.1, Math.random() * 0.1, Math.random() * 0.1); // 큐브마다 살짝 비틀어서 자연스럽게
  dummy.updateMatrix();
  mesh.setMatrixAt(i, dummy.matrix);
});
```

질감은 그레이스케일 색상을 랜덤으로 입힌 버텍스 컬러에, 노이즈 텍스처(랜덤 픽셀로 직접 만든 `DataTexture`)를 곱해서 콘크리트 같은 표면을 표현한다.

## 원리 3 — 자동 회전 + 드래그 인터랙션 + 위아래 bobbing

```javascript
function animate() {
  requestAnimationFrame(animate);
  time += 0.003;
  if (!isDragging) rotationY += 0.003 * 0.6; // 가만히 두면 천천히 자동 회전
  group.rotation.y = rotationY;
  group.position.y = Math.sin(time * 1.2) * 6; // 위아래로 살짝 흔들림
  mesh.instanceMatrix.needsUpdate = true;
  renderer.render(scene, camera);
}
```

마우스/터치 드래그의 가로 이동량만큼 `rotationY`를 더해서 사용자가 손으로 돌릴 수 있게 만들었고, 화면 폭이 768px 이하일 때는 컨테이너 높이와 카메라 거리(`camera.position.z`)를 강제로 좁혀서 모바일에서도 잘리지 않게 처리했다.

## 구현 순서 요약

1. three.js CDN 스크립트 추가
2. 숨겨진 canvas 두 개로 텍스트와 이미지의 픽셀 좌표를 각각 추출
3. 같은 y줄끼리 좌표를 매칭해서 3D 포인트 배열 생성
4. InstancedMesh로 큐브 배치, 그레이스케일+노이즈 텍스처 적용
5. requestAnimationFrame 루프에서 자동 회전 + sin 파형 bobbing
6. mousedown/mousemove/touchmove로 드래그 회전 구현
7. resize 이벤트에서 컨테이너 높이·카메라 위치 재계산

## 참고

- 소스: [text2context.com](https://text2context.com/) 상단 배너
- 라이브러리: `three.js r128` (cdnjs)
