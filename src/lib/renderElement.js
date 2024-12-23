import { createElement } from "./createElement";
import { normalizeVNode } from "./normalizeVNode";
import { setupEventListeners } from "./eventManager.js";
import { updateElement } from "./updateElement.js";

/*
 * Virtual DOM 기반 파이프라인
 * 1. JSX -> Virtual DOM 노드 생성 (createVNode)
 * 2. Virtual DOM 노드 정규화 (normalizeVNode)
 * 3. 실제 DOM 요소 생성 (createElement)
 * 4. DOM 렌더링 (renderElement)
 */
export function renderElement(vNode, container) {
  // 최초 렌더링시에는 createElement로 DOM을 생성하고
  // 이후에는 updateElement로 기존 DOM을 업데이트한다.
  // 렌더링이 완료되면 container에 이벤트를 등록한다.

  setupEventListeners(container);

  // 이전 가상 DOM 가져오기
  const oldVNode = container._vnode;

  // 새로운 가상 DOM 정규화
  const normalizedVNode = normalizeVNode(vNode);

  // 최초 렌더링
  if (!oldVNode) {
    container.appendChild(createElement(normalizedVNode));
  } else {
    // 기존 내용 제거 후 새로 렌더링
    updateElement(container, normalizedVNode, oldVNode, 0);
  }

  // 현재 가상 DOM 저장
  container._vnode = normalizedVNode;
}
