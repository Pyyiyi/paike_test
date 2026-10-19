import { beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import WorkloadStatisticsView from './WorkloadStatisticsView.vue';
import { statisticsApi, type WorkloadResult } from '@/shared/api/statistics.api';
import { useSemesterStore } from '@/shared/stores/semester';
import type { SemesterSummary } from '@/shared/api/types';

vi.mock('@/shared/api/statistics.api', () => ({
  statisticsApi: {
    workload: vi.fn(),
  },
}));

const semester: SemesterSummary = {
  semesterId: '00000000-0000-4000-8000-000000000020',
  name: '2026 秋季学期',
  academicYear: '2026-2027',
  term: 'FALL',
  startDate: '2026-09-01',
  endDate: '2027-01-31',
  status: 'IN_PROGRESS',
  scheduleTemplateVersionId: '00000000-0000-4000-8000-000000000030',
  isCurrent: true,
  version: 1,
};

function workloadResult(overrides: Partial<WorkloadResult> = {}): WorkloadResult {
  return {
    items: [
      {
        teacherId: '00000000-0000-4000-8000-000000000001',
        teacherName: '张老师',
        regular: 1,
        consecutive: 2,
        combined: 1,
        overtime: 0,
        total: 4,
      },
    ],
    scope: 'SEMESTER',
    weekIndex: null,
    weekCount: 18,
    publishedPlanId: '00000000-0000-4000-8000-000000000040',
    message: null,
    ...overrides,
  };
}

async function mountView() {
  const pinia = createPinia();
  setActivePinia(pinia);
  const semesterStore = useSemesterStore();
  semesterStore.list = [semester];
  semesterStore.current = semester;
  semesterStore.loaded = true;
  const wrapper = mount(WorkloadStatisticsView);
  await flushPromises();
  return wrapper;
}

describe('WorkloadStatisticsView', () => {
  beforeEach(() => {
    vi.mocked(statisticsApi.workload).mockReset();
  });

  it('renders four workload categories, the V1.1 overtime placeholder, and total', async () => {
    vi.mocked(statisticsApi.workload).mockResolvedValue(workloadResult());
    const wrapper = await mountView();

    expect(wrapper.text()).toContain('常规');
    expect(wrapper.text()).toContain('连堂');
    expect(wrapper.text()).toContain('合班');
    expect(wrapper.text()).toContain('加班');
    expect(wrapper.text()).toContain('张老师');
    expect(wrapper.text()).toContain('0（细则 V1.1）');
    expect(wrapper.text()).toContain('学期合计');
    expect(statisticsApi.workload).toHaveBeenCalledWith({
      semesterId: semester.semesterId,
      scope: 'SEMESTER',
      weekIndex: undefined,
    });
  });

  it('switches to week scope and requests the selected teaching week', async () => {
    vi.mocked(statisticsApi.workload)
      .mockResolvedValueOnce(workloadResult())
      .mockResolvedValueOnce(
        workloadResult({ scope: 'WEEK', weekIndex: 2, weekCount: 18 }),
      );
    const wrapper = await mountView();

    const scopeInputs = wrapper.findAll('input[type="radio"]');
    expect(scopeInputs).toHaveLength(2);
    await scopeInputs[1]?.setValue(true);
    await flushPromises();

    expect(statisticsApi.workload).toHaveBeenLastCalledWith({
      semesterId: semester.semesterId,
      scope: 'WEEK',
      weekIndex: 1,
    });
    expect(wrapper.text()).toContain('第 1 周合计');
  });

  it('shows the publish prompt when no PUBLISHED plan exists', async () => {
    vi.mocked(statisticsApi.workload).mockResolvedValue(
      workloadResult({
        items: [],
        publishedPlanId: null,
        message: '请先发布课表',
      }),
    );
    const wrapper = await mountView();

    expect(wrapper.text()).toContain('请先发布课表');
    expect(wrapper.text()).toContain('工作量只统计当前学期已发布的正式课表');
  });
});
