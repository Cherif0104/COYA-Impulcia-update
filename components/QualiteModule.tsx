import React from 'react';
import StructuredModulePage from './common/StructuredModulePage';
import ModuleRichHub from './common/ModuleRichHub';
import { useLocalization } from '../contexts/LocalizationContext';
import { Language } from '../types';

const QualiteModule: React.FC = () => {
  const { language } = useLocalization();
  const isFr = language === Language.FR;

  return (
    <StructuredModulePage
      moduleKey="qualite"
      titleFr="Qualité"
      titleEn="Quality"
      descriptionFr="Indicateurs qualité, processus, audits, non-conformités et lien avec la Trinité et les projets."
      descriptionEn="Quality indicators, processes, audits, non-conformities and links to Trinité and projects."
      icon="fas fa-check-double"
      sections={[
        {
          key: 'process',
          titleFr: 'Processus & audits',
          titleEn: 'Processes & audits',
          icon: 'fas fa-clipboard-list',
          content: (
            <p className="text-coya-text-muted text-sm leading-relaxed">
              {isFr
                ? 'Plan d’audit annuel, check-lists ISO-style, actions correctives avec responsables et échéances. Les exports peuvent être archivés dans COYA Drive.'
                : 'Annual audit plan, ISO-style checklists, corrective actions with owners and due dates. Exports can be archived in COYA Drive.'}
            </p>
          ),
        },
        {
          key: 'nc',
          titleFr: 'Non-conformités & CAPA',
          titleEn: 'Non-conformities & CAPA',
          icon: 'fas fa-exclamation-triangle',
          content: (
            <ul className="text-sm text-coya-text-muted list-disc list-inside space-y-1">
              <li>
                {isFr
                  ? 'Détection : manuelle ou import depuis tickets / incidents opérationnels.'
                  : 'Detection: manual or import from tickets / operational incidents.'}
              </li>
              <li>
                {isFr
                  ? 'CAPA : cause racine, actions, preuves, validation management.'
                  : 'CAPA: root cause, actions, evidence, management validation.'}
              </li>
            </ul>
          ),
        },
        {
          key: 'trinite',
          titleFr: 'Lien Trinité & scoring',
          titleEn: 'Trinité & scoring link',
          icon: 'fas fa-link',
          content: (
            <p className="text-coya-text-muted text-sm leading-relaxed">
              {isFr
                ? 'Les scores Trinité (Ndiguel, Yar, Barké) nourrissent les revues qualité individuelles ; les incidents projet alimentent les indicateurs de dérive process.'
                : 'Trinité scores (Ndiguel, Yar, Barké) feed individual quality reviews; project incidents feed process drift indicators.'}
            </p>
          ),
        },
      ]}
    >
      <ModuleRichHub
        isFr={isFr}
        metrics={[
          {
            labelFr: 'Indicateurs cibles',
            labelEn: 'Target indicators',
            value: '12',
            hintFr: 'Exemple pilotage (données à brancher)',
            hintEn: 'Sample steering (wire data)',
          },
          {
            labelFr: 'Audits planifiés',
            labelEn: 'Planned audits',
            value: '4',
            hintFr: 'Trimestre en cours',
            hintEn: 'Current quarter',
          },
          {
            labelFr: 'CAPA ouvertes',
            labelEn: 'Open CAPAs',
            value: '3',
            hintFr: 'Actions correctives',
            hintEn: 'Corrective actions',
          },
          {
            labelFr: 'Conformité (score)',
            labelEn: 'Compliance (score)',
            value: '94%',
            hintFr: 'Agrégat mock pour la démo',
            hintEn: 'Mock aggregate for demo',
          },
        ]}
        sections={[
          {
            key: 'q-scope',
            titleFr: 'Couverture cible du module Qualité',
            titleEn: 'Target Quality module coverage',
            icon: 'fas fa-chart-line',
            bulletsFr: [
              'Tableaux de bord par site / BU avec SLA qualité.',
              'Intégration Messagerie pour les escalades et le comité qualité.',
              'Paramètres : référentiel des types d’incident et gravité.',
            ],
            bulletsEn: [
              'Dashboards per site / BU with quality SLAs.',
              'Messaging integration for escalations and quality committee.',
              'Settings: referential for incident types and severity.',
            ],
          },
        ]}
      />
    </StructuredModulePage>
  );
};

export default QualiteModule;
