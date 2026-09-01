const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

const revealItems = document.querySelectorAll('[data-reveal]');
if ('IntersectionObserver' in window && !prefersReducedMotion) {
  const revealObserver = new IntersectionObserver((entries, observer) => {
    entries.forEach((entry) => {
      if (!entry.isIntersecting) return;
      entry.target.classList.add('is-visible');
      observer.unobserve(entry.target);
    });
  }, { threshold: 0.14, rootMargin: '0px 0px -6% 0px' });
  revealItems.forEach((item) => revealObserver.observe(item));
} else {
  revealItems.forEach((item) => item.classList.add('is-visible'));
}

const progress = document.querySelector('.scroll-progress span');
const header = document.querySelector('[data-header]');
let scrollFrame = 0;

const updateScrollState = () => {
  const maxScroll = document.documentElement.scrollHeight - window.innerHeight;
  const ratio = maxScroll > 0 ? window.scrollY / maxScroll : 0;
  progress.style.transform = `scaleX(${Math.min(1, Math.max(0, ratio))})`;
  header.classList.toggle('is-scrolled', window.scrollY > 32);
  scrollFrame = 0;
};

window.addEventListener('scroll', () => {
  if (scrollFrame) return;
  scrollFrame = window.requestAnimationFrame(updateScrollState);
}, { passive: true });
updateScrollState();

const storySteps = [...document.querySelectorAll('[data-story-step]')];
const stageImages = [...document.querySelectorAll('[data-stage-image]')];
const stageLabel = document.querySelector('[data-stage-label]');
const stageUrl = document.querySelector('[data-stage-url]');
const stageCounter = document.querySelector('[data-stage-counter]');
const stageCaption = document.querySelector('[data-stage-caption]');

const storyContent = [
  {
    label: 'COMPOSE / WORKFLOW CANVAS',
    url: 'workflow / AI PC 晨间工作台',
    counter: '01 — 03',
    caption: '拖拽节点，连接意图、推理与本机能力。',
  },
  {
    label: 'CONTROL / PERMISSION CENTER',
    url: 'runtime / devices & approvals',
    counter: '02 — 03',
    caption: '设备在线、权限申请与持续授权一处管理。',
  },
  {
    label: 'OBSERVE / RUN TRACKING',
    url: 'dashboard / recent activity',
    counter: '03 — 03',
    caption: '每次运行状态与关键事件保持清晰可见。',
  },
];

const setStoryStep = (index) => {
  const content = storyContent[index];
  if (!content) return;
  storySteps.forEach((step, stepIndex) => {
    step.classList.toggle('is-active', stepIndex === index);
    step.classList.toggle('is-past', stepIndex < index);
  });
  stageImages.forEach((image, imageIndex) => image.classList.toggle('is-active', imageIndex === index));
  stageLabel.textContent = content.label;
  stageUrl.textContent = content.url;
  stageCounter.textContent = content.counter;
  stageCaption.textContent = content.caption;
};

if ('IntersectionObserver' in window) {
  const storyObserver = new IntersectionObserver((entries) => {
    const visible = entries
      .filter((entry) => entry.isIntersecting)
      .sort((a, b) => Math.abs(a.boundingClientRect.top - window.innerHeight * 0.42) - Math.abs(b.boundingClientRect.top - window.innerHeight * 0.42));
    if (visible[0]) setStoryStep(Number(visible[0].target.dataset.storyStep));
  }, { threshold: [0.3, 0.55], rootMargin: '-15% 0px -44% 0px' });
  storySteps.forEach((step) => storyObserver.observe(step));
}
storySteps.forEach((step) => step.addEventListener('click', () => setStoryStep(Number(step.dataset.storyStep))));

const flowNodes = [...document.querySelectorAll('[data-flow]')];
const flowLines = [...document.querySelectorAll('.flow-line')];
const flowCopy = document.querySelector('[data-flow-copy]');
const flowMeta = document.querySelector('[data-flow-meta]');
const flowTime = document.querySelector('[data-flow-time]');

const flowStates = [
  {
    phase: 'INPUT RECEIVED',
    title: '“打开记事本，准备记录会议内容”',
    copy: '工作流已识别目标设备与所需能力，开始生成可审核的执行计划。',
    device: 'Studio AI PC', capability: 'app.launch', state: 'PLANNING', time: '00:00.184',
  },
  {
    phase: 'PLAN GENERATED',
    title: '选择 Windows 应用适配器：Notepad',
    copy: '模型只生成已注册的结构化调用，不会发送任意 Shell 命令。',
    device: 'Studio AI PC', capability: 'app.launch', state: 'READY', time: '00:00.618',
  },
  {
    phase: 'HUMAN IN THE LOOP',
    title: '请求批准：在本机启动 Notepad',
    copy: '你可以仅批准这一次、授予持续权限，或者拒绝。决定会进入审计记录。',
    device: 'Studio AI PC', capability: 'app.launch', state: 'AWAITING', time: '00:03.204',
  },
  {
    phase: 'ADAPTER COMPLETED',
    title: 'Notepad 已在本机成功启动',
    copy: 'Runtime 返回结构化结果，执行状态与耗时已经写入本次运行轨迹。',
    device: 'Studio AI PC', capability: 'app.launch', state: 'SUCCEEDED', time: '00:03.391',
  },
];

const setFlow = (index) => {
  const state = flowStates[index];
  if (!state) return;
  flowNodes.forEach((node, nodeIndex) => {
    const active = nodeIndex === index;
    node.classList.toggle('is-active', active);
    node.setAttribute('aria-selected', String(active));
  });
  flowLines.forEach((line, lineIndex) => line.classList.toggle('is-lit', lineIndex < index));
  flowCopy.innerHTML = `<small>${state.phase}</small><strong>${state.title}</strong><p>${state.copy}</p>`;
  flowMeta.innerHTML = `<span><small>DEVICE</small>${state.device}</span><span><small>CAPABILITY</small>${state.capability}</span><span><small>STATE</small><b>${state.state}</b></span>`;
  flowTime.textContent = state.time;
};

flowNodes.forEach((node, index) => {
  node.addEventListener('click', () => setFlow(index));
  node.addEventListener('keydown', (event) => {
    if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return;
    event.preventDefault();
    const direction = event.key === 'ArrowRight' ? 1 : -1;
    const next = (index + direction + flowNodes.length) % flowNodes.length;
    setFlow(next);
    flowNodes[next].focus();
  });
});

if (!prefersReducedMotion && window.matchMedia('(pointer: fine)').matches) {
  const tiltCard = document.querySelector('[data-tilt]');
  tiltCard.addEventListener('pointermove', (event) => {
    const rect = tiltCard.getBoundingClientRect();
    const x = (event.clientX - rect.left) / rect.width - 0.5;
    const y = (event.clientY - rect.top) / rect.height - 0.5;
    tiltCard.style.setProperty('--ry', `${x * 4.5}deg`);
    tiltCard.style.setProperty('--rx', `${y * -4.5}deg`);
  });
  tiltCard.addEventListener('pointerleave', () => {
    tiltCard.style.setProperty('--ry', '0deg');
    tiltCard.style.setProperty('--rx', '0deg');
  });

  document.querySelectorAll('.magnetic').forEach((button) => {
    button.addEventListener('pointermove', (event) => {
      const rect = button.getBoundingClientRect();
      const x = (event.clientX - rect.left - rect.width / 2) * 0.08;
      const y = (event.clientY - rect.top - rect.height / 2) * 0.08;
      button.style.transform = `translate(${x}px, ${y}px)`;
    });
    button.addEventListener('pointerleave', () => { button.style.transform = ''; });
  });
}
