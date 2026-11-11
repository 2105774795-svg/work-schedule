/* 虚构的产业园咨询项目，用于演示工作分解和工作簿导出。 */
(function (root) {
  'use strict';

  const examples = [
    ['总体研究', '市场调研', 0, 0, '研究成员', '梳理目标行业近三年的公开经营数据', '行业数据表及来源目录'],
    ['总体研究', '市场调研', 0, 1, '研究成员', '访谈潜在入园企业并核对空间和配套需求', '访谈纪要及共性需求清单'],
    ['总体研究', '现场踏勘', 0, 0, '项目负责人', '踏勘拟选地块并记录供电、道路和排水条件', '现场踏勘记录及待核实事项'],
    ['总体研究', '产业分析', 1, 1, '研究成员', '分析目标产业的上下游衔接和区域供给缺口', '产业链及供给缺口分析'],
    ['规划定位', '客群分布', 1, 1, '研究成员', '按企业成长阶段和服务需求划分目标客群', '目标客群分类表'],
    ['规划定位', '市场定位', 2, 2, '项目负责人', '比较园区面向不同客群的服务定位', '园区定位比选说明'],
    ['规划定位', '片区规划', 2, 3, '项目负责人', '核对生产、仓储和公共服务空间的功能关系', '功能分区建议及约束清单'],
    ['子项谋划', '地块研究', 2, 2, '保障成员', '汇总用地指标并核对各拟建子项的用地条件', '用地条件核对表'],
    ['子项谋划', '规模设计', 3, 4, '项目负责人', '按入驻需求推算建筑面积及公共设施规模', '分业态规模测算表'],
    ['子项谋划', '投产测算', 4, 5, '保障成员', '根据工程量和运营参数估算建设与维护支出', '建设投资与运维成本测算表'],
    ['融资策划', '政策红利梳理', 4, 4, '保障成员', '核对可适用政策的申报条件和材料要求', '政策适用性及申报材料清单'],
    ['融资策划', '资金路径设计', 5, 5, '保障成员', '测算不同分期方案下的资本金与资金缺口', '分期资金需求及缺口表'],
    ['融资策划', '多渠道融资策划', 5, 6, '项目负责人', '比较筹资渠道的期限、成本和使用限制', '筹资方案比选表'],
    ['金融对接', '征集方案设计', 6, 6, '项目负责人', '编制金融机构沟通材料及统一问题清单', '机构沟通材料及问题清单'],
    ['金融对接', '四轮金融征集（商务）', 7, 7, '保障成员', '汇总机构反馈并核对各方案的费用和条件', '融资条件对照表'],
    ['资金落地', '融资材料编制', 8, 9, '保障成员', '整理融资申请材料并标记需补充的证明文件', '申请材料目录及补充清单'],
    ['运营策划', '功能分区', 6, 7, '研究成员', '核对园区各运营空间的使用时段与共享条件', '运营空间共享方案'],
    ['运营策划', '运营方案设计', 7, 8, '项目负责人', '测算运营人员配置和服务收费的情景差异', '运营情景测算及岗位建议'],
    ['运营洽商', '专业运营征集', 8, 8, '研究成员', '制定运营服务商征集范围及基础筛选条件', '征集方案及筛选条件'],
    ['运营洽商', '合作意向达成', 9, 10, '项目负责人', '整理意向单位提出的运营边界和待协商事项', '运营合作事项清单'],
    ['运营进场', '考核机制设计', 10, 10, '保障成员', '明确开园准备阶段的考核指标与核验材料', '开园准备考核表'],
    ['运营进场', '合作协议编制', 11, 12, '项目负责人', '拟定进场交接、设施维护及服务验收条款', '交接清单及合作协议草案'],
  ];

  function sampleMonth(offset) {
    const month = 9 + offset;
    return String(2026 + Math.floor(month / 12)) + String(month % 12 + 1).padStart(2, '0');
  }

  const tasks = examples.map(([module, category, from, to, owner, work, output], index) => ({
    seq: String(index + 1),
    module,
    category,
    period: `${sampleMonth(from)}-${sampleMonth(to)}`,
    owner,
    work,
    output,
    partner: '',
    status: '未开始',
    difficulty: '',
    notes: '',
  }));

  const style = (fontId, fillId, borderId, horizontal = 'left') =>
    `<xf numFmtId="0" fontId="${fontId}" fillId="${fillId}" borderId="${borderId}" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="${horizontal}" vertical="center" wrapText="1"/></xf>`;
  // 工作簿标题、表头和明细各自使用固定样式编号。
  const styles = [
    style(0, 0, 0), style(1, 2, 0), style(0, 2, 0), style(0, 0, 0),
    style(0, 3, 0), style(1, 2, 1, 'center'), style(0, 0, 1, 'center'),
    style(0, 0, 1), style(0, 0, 1), style(0, 4, 1, 'center'),
    style(0, 0, 1, 'center'), style(1, 3, 1, 'center'),
  ];
  const solidFill = rgb => `<fill><patternFill patternType="solid"><fgColor rgb="${rgb}"/><bgColor indexed="64"/></patternFill></fill>`;
  const border = ['left', 'right', 'top', 'bottom'].map(side => `<${side} style="thin"><color rgb="FFCFDFDB"/></${side}>`).join('');
  const stylesXml = `<?xml version="1.0" encoding="UTF-8"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <fonts count="2"><font><sz val="11"/><name val="Microsoft YaHei"/></font><font><b/><sz val="11"/><name val="Microsoft YaHei"/></font></fonts>
  <fills count="5"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill>${['FFC5E7DB', 'FFEAF5F1', 'FFFFF0C2'].map(solidFill).join('')}</fills>
  <borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border><border>${border}<diagonal/></border></borders>
  <cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
  <cellXfs count="${styles.length}">${styles.join('')}</cellXfs>
  <cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;

  const rowStyle = status => [6, 6, 7, 6, 8, 8, 7, 7, status, 8, 8, ...Array(13).fill(10), 11];
  const data = {
    tasks,
    stylesXml,
    themeXml: '',
    rowStyles: { '未开始': rowStyle(6), '进行中': rowStyle(9), '已完成': rowStyle(6) },
    source: '公开演示项目（虚构）',
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = data;
  else root.WorkPlanReference = data;
})(typeof window !== 'undefined' ? window : globalThis);
