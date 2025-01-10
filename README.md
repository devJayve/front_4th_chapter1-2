## 과제 셀프회고
React의 핵심 개념들에 대한 심층적인 이해가 부족했던 터라, Virtual DOM의 본질적인 메커니즘에 대해서도 피상적으로만 이해하고 있었습니다. 
누군가 Virtual DOM에 대해 물어본다면 아마 이렇게 답변했을 것 같습니다..
> *"가상돔은 diffing 알고리즘으로 DOM 업데이트를 최적화해서 빠르게 돌아간다!"*

그래서 준일 코치님의 발제 시간에 들었던 "가상 돔이 항상 성능 향상을 보장하지 않으며
작은 규모에선 오히려 오버헤드가 될 수 있다"는 말씀이 나름의 충격이었습니다. 그렇다보니 가상 돔을 이론적인 글로 살펴보는
것 뿐만 아니라 직접 구현해보며 더 구체적으로 케이스를 공부할 수 있어 더더욱 좋은 기회였습니다. 주로 학습한 내용은
다음과 같습니다.
- 가상돔을 생성하는 파이프라인에 대한 이해
- 가상돔의 필요성과 효율적인 관리 (Garbage Collection 기반 동작 등)
- 합성 이벤트 시스템과 이벤트 위임 메커니즘 설계

가장 고민하며 구현한 부분은 **이벤트 처리 시스템**입니다. DOM 이벤트를 루트 컨테이너에 위임하되, 이벤트 핸들러들을 Map에 저장하고
유지하는 방식으로 설계했습니다. 여기에 리액트의 합성 이벤트 시스템 방식을 차용하여 핵심 코드를 리팩토링하였습니다. 이를 위해 리액트 소스코드를 ~~Deep Dive~~(Shallow Dive에 가까운..) 해보았습니다.  

### React 톺아보기 (이벤트 시스템)
> React 라이브러리 코드를 직접 보며 해석한 내용이다보니 잘못된 내용에 대한 지적, 피드백을 적극 환영합니다 🙌  

이벤트 처리의 핵심 파이프라인을 따라가보겠습니다. 리액트는 루트 컨테이너를 생성하면서 이벤트 리스너를 등록합니다.
```js
export function createRoot(container, options) {
  
  // rootContainer를 설정
  const rootContainerElement = container.nodeType === COMMENT_NODE  
    ? container.parentNode  
    : container;


  // rootContainer에 지원하는 이벤트에 대한 리스너 등록
  listenToAllSupportedEvents(rootContainerElement);
```
`listenToAllSupportedEvents`는 Native Event Set을 순회하면서 각각의 이벤트 마다
개별적으로 리스너를 등록합니다. 이때 이벤트 위임 여부에 따라 적절한 플래그를 설정하고 이벤트를 등록합니다.
```js
export function listenToAllSupportedEvents(rootContainerElement) {
  ...
  allNativeEvents.forEach(domEventName => {
    if (!nonDelegatedEvents.has(domEventName)) {  
      listenToNativeEvent(domEventName, false, rootContainerElement);  
    }  
    listenToNativeEvent(domEventName, true, rootContainerElement);  
  })
}
```
`listenToNativeEvent` 함수 내에서 flag에 대한 별도의 처리를 한 뒤 `addTrappedEventListener`를 호출합니다. `createEventListenerWrapperWithPriority` 
함수를 통해 어떤 우선순위에 따라 listener를 가져오고 해당 리스너를 flag 값에 따라 이벤트 버블 리스너, 이벤트 캡쳐 리스너로 분류하여 등록합니다.

```js
function addTrappedEventListener(
  targetContainer,
  domEventName,
  eventSystemFlags,
  isCapturePhaseListener,
  isDeferredListenerForLegacyFBSupport
) {
  let listener = createEventListenerWrapperWithPriority(
    targetContainer,
    domEventName,
    eventSystemFlags,
  );
  if (isCapturePhaseListener) { // 캡쳐 페이즈 리스너
    unsubscribeListener = addEventCaptureListener(
      targetContainer,
      domEventName,
      listener,
    );
  } else { // 버블 페이즈 리스너
    unsubscribeListener = addEventBubbleListener(
      targetContainer,
      domEventName,
      listener,
    );
  }
}
```
이제 리스너가 최종적으로 등록되는 시점은 알았으니 우선순위에 따라 리스너를 생성하는 로직을 살펴보겠습니다. 아래 `getEventPriority`의 경우 이벤트 이름에 따라
리액트에서 지정한 우선순위를 구별하여 값을 가져옵니다. 여기서 우선순위에 따라 각각 다른 함수를 변수에 할당해주고 있는데 핵심은 모두 같은 `dispatchEvent`를 기반으로
두고 있다는 것입니다. 결국 클라이언트에서 실제 이벤트가 발생되었을 때 `dispatchEvent`가 트리거되게 됩니다. 
```js
export function createEventListenerWrapperWithPriority(
  targetContainer,
  domEventName,
  eventSystemFlags
) {
  const eventPriority = getEventPriority(domEventName);
  let listenerWrapper;
  switch (eventPriority) {
    case DiscreteEventPriority:
      listenerWrapper = dispatchDiscreteEvent;
      break;
    case ContinuousEventPriority:
      listenerWrapper = dispatchContinuousEvent;
      break;
    case DefaultEventPriority:
    default:
      listenerWrapper = dispatchEvent;
      break;
  }
}
```
`dispatchEvent`는 몇 가지 과정을 거쳐 `dispatchEventsForPlugins`함수에 도달하게 됩니다.
해당 함수에서는 `extractEvents` -> `processDispatchQueue` 순으로 호출됩니다.  
먼저 `extractEvent`의 흐름을 살펴보겠습니다. 
1. 해당 함수는 이벤트명을 기준으로 합성이벤트를 생성
2. target 컨테이너를 기준으로 탐색하며 리스너를 수집 (`accumulateSinglePhaseListeners`)
3. 합성이벤트와 리스너들을 dispatchQueue에 삽입  
 
위와 같은 과정을 통해 합성이벤트 생성과 target 컨테이너에서 리스너를 수집하여 등록하였다면 `processDispatchQueue`
를 통해 적절한 우선순위에 따라 큐 안의 이벤트들을 처리하게 됩니다.  
실제 리액트에서는 훨씬 더 복잡한 엣지 케이스들을 고려하고 있지만 이번 분석을 통해 리액트 이벤트 시스템의 아키텍쳐를 이해할 수 있는 좋은 기회였습니다.

### 합성 이벤트 실제 구현
위와 같은 리액트의 접근 방식을 참고하여 합성 이벤트 시스템을 구현해보았습니다. 먼저 지원하는 이벤트명을 기준으로 각각 리스너를 등록합니다.
```js
export function setupEventListeners(root) {
  supportedEventNames.forEach((eventName) => {
    listenToNativeEvent(root, eventName);
  });
}
```
이때 리스너가 트리거될 경우 `dispatchEvent`가 호출됩니다. 위에서 리액트의 흐름과 같이 `extractEvent`함수를 통해
합성 이벤트를 생성하고, target 컨테이너를 기준으로 버블링 순회하며 핸드러를 수집합니다.
```js
const syntheticEvent = extractEvent(
  domEventName,
  nativeEvent,
  nativeEvent.target,
);
const dispatchQueue = accumulateListeners(
  nativeEvent.target,
  targetContainer,
  domEventName,
);
```
