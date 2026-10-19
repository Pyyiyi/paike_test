const path = require('node:path');

function createBoundaryZones(moduleContexts) {
  const crossDomainInternals = [
    './backend/src/modules/*/**/*.repository.ts',
    './backend/src/modules/*/**/*.domain.ts',
  ];

  const crossDomainZones = moduleContexts.map((context) => ({
    target: `./backend/src/modules/${context}`,
    from: crossDomainInternals,
    except: [
      `${path.resolve('backend/src/modules', context).replaceAll('\\', '/')}/**/*.repository.ts`,
      `${path.resolve('backend/src/modules', context).replaceAll('\\', '/')}/**/*.domain.ts`,
    ],
    message:
      '禁止跨上下文直接引用 repository/domain；请通过对方应用服务、查询服务或领域事件协作。',
  }));

  return [
    {
      target: './backend/src/shared',
      from: './backend/src/modules',
      message: 'shared 是共享内核，不得依赖 modules；请反转依赖或将能力移入 shared。',
    },
    {
      target: './frontend/src/shared',
      from: './frontend/src/views',
      message: 'frontend shared 不得依赖业务 views；请将跨域 UI 能力移到 shared。',
    },
    ...crossDomainZones,
  ];
}

module.exports = { createBoundaryZones };
