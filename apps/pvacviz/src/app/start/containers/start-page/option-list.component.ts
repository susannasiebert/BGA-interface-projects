import { Component, Input, forwardRef } from '@angular/core';

@Component({
  selector: '[option-list]',
  templateUrl: './option-list.component.html'
})

export class OptionList {
  @Input() files;
  @Input() parent: string;
  constructor() {
  }
}