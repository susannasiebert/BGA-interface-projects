import { Component, Input, forwardRef, OnInit, OnDestroy, AfterViewInit } from '@angular/core';

import { Observable, Subject, BehaviorSubject, Subscription } from 'rxjs/Rx';
import { map, filter, take, combineLatest, startWith, withLatestFrom, debounceTime, tap, switchMap, distinctUntilChanged, throttleTime } from 'rxjs/operators';

import { Store, select, createSelector } from '@ngrx/store';

import {
  FormGroupState,
  ResetAction,
  SetValueAction,
  FormControlState,
  DisableAction,
  EnableAction,
  unbox
} from 'ngrx-forms';
import { NgSelectComponent } from '@ng-select/ng-select';
import { StartFormGroupValue } from '@pvz/start/models/start-form.models';

import { File, Files } from '@pvz/core/models/file.model';
import { ProcessParameters } from '@pvz/core/models/process-parameters.model';
import { Algorithm, Allele, ApiMeta } from '@pvz/core/models/api-responses.model';
import { InputService } from '@pvz/core/services/inputs.service';

import * as fromInputsActions from '@pvz/start/actions/inputs.actions';
import * as fromAllelesActions from '@pvz/start/actions/alleles.actions';
import * as fromAlgorithmsActions from '@pvz/start/actions/algorithms.actions';
import * as fromStartActions from '@pvz/start/actions/start.actions';
import * as fromStart from '@pvz/start/reducers';
import { INITIAL_STATE } from '@pvz/start/reducers/start.reducer';

@Component({
  selector: 'pvz-start-page',
  templateUrl: './start-page.component.html',
  styleUrls: ['./start-page.component.scss']
})
export class StartPageComponent implements OnInit, OnDestroy {
  private subscriptions: Subscription[] = [];

  inputs$: Observable<Files>;

  algorithmsControl$: Observable<any>;
  algorithms$: Observable<Array<Algorithm>>;

  allelesControl$: Observable<any>;
  alleles$: Observable<Array<Allele>>;
  alleles: Allele[] = []; // stores allele objects for alleles select
  concatAlleles: boolean = false;
  allelesTypeahead$ = new BehaviorSubject<string>('');
  allelesScroll$ = new Subject<any>();
  allelesScrollToEnd$ = new Subject<any>();
  allelesMeta$: Observable<ApiMeta>;
  allelesLoading$: Observable<boolean>;

  predictionAlgorithms$: Observable<Array<string>>;

  epitopeLengthsControl$: Observable<any>;

  netChopMethodOptions: {};
  topScoreMetricOptions: {};
  epitopeLengths: string[];

  formState$: Observable<FormGroupState<StartFormGroupValue>>;
  formPost$: Observable<{}>;
  submittedValue$: Observable<StartFormGroupValue>;
  newProcessId$: Observable<number>;

  constructor(
    private store: Store<fromStart.State>,
  ) {
    this.formState$ = store.pipe(select(fromStart.getFormState), map(s => s.state));
    this.submittedValue$ = store.pipe(select(fromStart.getSubmittedValue),
      filter(v => v !== undefined && v !== null));

    // TODO do this grouping in the service or create a new selector in start.reducer
    this.inputs$ = store.pipe(select(fromStart.getAllInputs), map((inputs) => {
      let options = [];
      let dir = '~pVAC-Seq';

      function groupFiles(dir, contents) {
        contents.forEach((item) => {
          if (item.type === "file") {
            let option = {
              display_name: item.display_name,
              fileID: item.fileID,
              directory: dir
            }
            options.push(option);
          } else if (item.type === "directory") {
            dir = dir + '/' + item.display_name;
            groupFiles(dir, item.contents);
          }
        })
      }
      groupFiles(dir, inputs);
      return options;
    }));
    this.algorithmsControl$ = store.pipe(select(fromStart.getFormControl('prediction_algorithms')));
    this.algorithms$ = store.pipe(select(fromStart.getAllAlgorithms));

    this.alleles$ = store.pipe(select(fromStart.getAllAlleles));
    this.allelesMeta$ = store.pipe(select(fromStart.getStartState), map(state => state.alleles.meta))
    this.allelesLoading$ = store.pipe(select(fromStart.getStartState), map(state => state.alleles.loading));
    this.formPost$ = store.pipe(select(fromStart.getStartState), map(state => state.post));
    this.newProcessId$ = store.pipe(select(fromStart.getStartState), map(state => state.post.processid));

    // concatAlleles flag, set by predictionAlgorithms$, allelesTypeahead$, and allelesScrollToEnd$ subscriptions
    // scrollToEnd required concat, others replacement of alleles array
    this.subscriptions.push(
      this.alleles$.subscribe((alleles) => {
        if (this.concatAlleles) {
          this.alleles = this.alleles.concat(alleles);
        } else {
          this.alleles = alleles;
        }
      })
    );

    this.subscriptions.push(
      this.algorithmsControl$.subscribe((control) => {
        this.concatAlleles = false;
        if (control.isValid) {
          const req = {
            prediction_algorithms: unbox(control.value).join(','),
            page: 1,
            count: dropdownPageCount
          }
          this.store.dispatch(new EnableAction('startForm.alleles'));
          this.store.dispatch(new fromAllelesActions.LoadAlleles(req));
        } else {
          this.store.dispatch(new DisableAction('startForm.alleles'));
          this.store.dispatch(new fromAllelesActions.ClearAlleles());
        }
      }));

    // reload alleles when typeahead updates
    this.subscriptions.push(
      this.allelesTypeahead$.pipe(
        debounceTime(100),
        distinctUntilChanged(),
        filter(term => term && term.length > 0),
        withLatestFrom(this.allelesMeta$, this.algorithmsControl$)
      ).subscribe(([term, meta, control]) => {
        const req = {
          prediction_algorithms: unbox(control.value).join(','),
          name_filter: term,
          page: 1,
          count: dropdownPageCount
        }
        this.concatAlleles = false;
        this.store.dispatch(new fromAllelesActions.LoadAlleles(req))
      }));

    const dropdownPageCount = 50; // items loaded per alleles select page-load
    const loadPageOnScrollStart = .35 // query next page of results on scroll start > alleles.length - Math.floor(alleles.length / loadPageOnScrollStart)
    // load next page of alleles when dropdown scrolls past loadPageOnScrollStart% of allele length
    this.subscriptions.push(
      Observable
        .merge(this.allelesScroll$, this.allelesScrollToEnd$)
        .pipe(
          throttleTime(100),
          withLatestFrom(this.allelesMeta$, this.algorithmsControl$, this.allelesTypeahead$)
        ).subscribe(([event, meta, control, term]) => {
          const req = {
            prediction_algorithms: unbox(control.value).join(','),
            name_filter: term,
            page: meta.current_page + 1,
            count: dropdownPageCount
          }
          let loadAlleles = req.page <= meta.total_pages;
          if (loadAlleles) {
            this.concatAlleles = true;
            this.store.dispatch(new fromAllelesActions.LoadAlleles(req))
          }
        }));

    this.epitopeLengths = ['8', '9', '10', '11', '12', '13', '14'];

    this.netChopMethodOptions = [
      { label: 'Skip Netchop', value: '' },
      { label: 'C term 3.0', value: 'cterm' },
      { label: '20S 3.0', value: '20s' },
    ];

    this.topScoreMetricOptions = [
      { label: 'Median Score', value: 'median' },
      { label: 'Lowest Score', value: 'lowest' },
    ];
  }

  onSubmit() {
    this.subscriptions.push(
      this.formState$.pipe(
        take(1),
        map(fs => new fromStartActions.SetSubmittedValueAction(fs.value))).subscribe(this.store));
  }

  selectTest(action) {
    if (action === 'disable') {
      this.store.dispatch(new DisableAction('startForm.input'));
    } else {
      this.store.dispatch(new EnableAction('startForm.input'));
    }
  }

  reset() {
    this.store.dispatch(new SetValueAction(INITIAL_STATE.id, INITIAL_STATE.value));
    this.store.dispatch(new ResetAction(INITIAL_STATE.id));
  }

  ngOnInit() {
    this.store.dispatch(new fromInputsActions.LoadInputs());
    this.store.dispatch(new fromAlgorithmsActions.LoadAlgorithms());
  }

  ngOnDestroy() {
    if (this.subscriptions.length > 0) {
      this.subscriptions.forEach(sub => sub.unsubscribe());
    }
    this.reset();
  }
}
